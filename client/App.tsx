import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
	DefaultSizeStyle,
	Editor,
	ErrorBoundary,
	TLComponents,
	Tldraw,
	TldrawUiToastsProvider,
	TldrawUiButton,
	TldrawUiButtonLabel,
	TldrawUiButtonIcon,
	TLUiOverrides,
	useColorMode,
} from 'tldraw'
import { TldrawAgentApp } from './agent/TldrawAgentApp'
import {
	TldrawAgentAppContextProvider,
	TldrawAgentAppProvider,
} from './agent/TldrawAgentAppProvider'
import { ChatPanel } from './components/ChatPanel'
import { ChatPanelFallback } from './components/ChatPanelFallback'
import { AgentSetupPanel } from './components/AgentSetupPanel'
import { CustomHelperButtons } from './components/CustomHelperButtons'
import { BasRuntimeProvider } from './bas/BasRuntimeContext'
import { BasWorkspaceProvider } from './bas/BasWorkspaceContext'
import { useBasWorkspace } from './bas/useBasWorkspace'
import {
	BAS_TABLE_SHAPE_TYPE,
	BAS_TREND_SHAPE_TYPE,
	dataWidgetPointReferences,
} from './bas/DataWidgetShapes'
import { ShellUiContext, ShellUiContainer, ShellDialogs, ShellMenuPanel, ShellNavigationPanel, ShellToolbar, ShellStylePanel } from './components/ShellUi'

import { pluginRegistry } from './plugins/builtinPlugins'
import { useBasdrawPlugins } from './plugins/PluginContext'
import {
	PluginAppPanels,
	PluginCanvasOverlays,
	PluginProviders,
	PluginShapeWrapper,
	usePluginEditorMount,
} from './plugins/PluginComponents'
import { PluginManager } from './plugins/PluginManager'
import { BASDRAW_PROJECT_ID } from '../shared/knowledge'
import { setCurrentKnowledgeScope } from './knowledge/currentKnowledgeScope'
import { EMPTY_AGENT_STATUS, type AgentStatus } from '../shared/models'
import { useAccessPolicy } from './access/AccessPolicyContext'
import { AccessModeMenu } from './access/AccessModeMenu'
import { agentPluginRuntime } from './plugins/AgentPluginRuntime'

// Customize tldraw's styles to play to the agent's strengths
DefaultSizeStyle.setDefaultValue('s')

// All installed types stay registered so disabling a plugin never makes an existing canvas unreadable.
const tools = pluginRegistry.tools()
const overlayUtils = pluginRegistry.overlayUtils()
const shapeUtils = pluginRegistry.shapeUtils()

function App() {
	const [app, setApp] = useState<TldrawAgentApp | null>(null)
	const [editor, setEditor] = useState<Editor | null>(null)
	const [colorMode, setColorMode] = useState<'light' | 'dark'>('light')
	const [canvasTitle, setCanvasTitle] = useState('Untitled canvas')
	const [agentStatus, setAgentStatus] = useState<AgentStatus>(EMPTY_AGENT_STATUS)
	const [showAi, setShowAi] = useState(false)
	const [aiContainer, setAiContainer] = useState<HTMLDivElement | null>(null)
	const [headerContainer, setHeaderContainer] = useState<HTMLDivElement | null>(null)
	const [uiContainer, setUiContainer] = useState<HTMLDivElement | null>(null)
	const [liveEffects, setLiveEffects] = useState(true)
	const [widgetPointReferences, setWidgetPointReferences] = useState<string[]>([])
	const [pageShapeIds, setPageShapeIds] = useState<string[]>([])
	const [dataWidgetCount, setDataWidgetCount] = useState(0)
	const { enabled, isEnabled } = useBasdrawPlugins()
	const { policy } = useAccessPolicy()
	const agentPluginEnabled = isEnabled('canvas-agent')
	const agentEnabled = agentPluginEnabled && policy.ai !== 'off'
	const aiAvailable = agentStatus.configured
	const baskstreamPluginEnabled = isEnabled('niagara-baskstream')
	const workspace = useBasWorkspace(editor, widgetPointReferences, pageShapeIds, baskstreamPluginEnabled)
	const overrides = useMemo<TLUiOverrides>(() => ({
		translations: { en: pluginRegistry.translations(enabled) },
		tools: (editor, defaultTools) => Object.assign({}, defaultTools, ...pluginRegistry.uiTools(enabled).map(({ id, create }) => ({ [id]: create(editor) }))),
	}), [enabled])
	usePluginEditorMount(editor)
	useEffect(() => {
		if (!agentEnabled) setShowAi(false)
	}, [agentEnabled])
	useEffect(() => {
		agentPluginRuntime.setPlugins(enabled)
		return () => agentPluginRuntime.clear()
	}, [enabled])
	useEffect(() => {
		if (!editor) return
		const readonly = policy.canvas === 'read'
		editor.updateInstanceState({ isReadonly: readonly })
		if (readonly) editor.setCurrentTool('select')
	}, [editor, policy.canvas])
	useEffect(() => {
		setCurrentKnowledgeScope({
			projectId: BASDRAW_PROJECT_ID,
			connectionId: workspace.connectedProfile?.alias ?? null,
			pluginIds: enabled.map((plugin) => plugin.id),
		})
		return () => setCurrentKnowledgeScope({ projectId: null, connectionId: null, pluginIds: [] })
	}, [enabled, workspace.connectedProfile?.alias])
	const handleUnmount = useCallback(() => {
		setApp(null)
	}, [])

	const refreshAgentStatus = useCallback(() => {
		if (!agentEnabled) {
			setAgentStatus(EMPTY_AGENT_STATUS)
			return
		}
		void fetch('/agent/status')
			.then((response) => response.ok ? response.json() : null)
			.then((result: unknown) => {
				if (!result || typeof result !== 'object') return setAgentStatus(EMPTY_AGENT_STATUS)
				const status = result as Partial<AgentStatus>
				setAgentStatus({
					configured: Boolean(status.configured),
					providers: {
						codex: Boolean(status.providers?.codex),
						openai: Boolean(status.providers?.openai),
						anthropic: Boolean(status.providers?.anthropic),
						google: Boolean(status.providers?.google),
					},
					codex: status.codex && typeof status.codex === 'object' ? {
						available: Boolean(status.codex.available),
						authenticated: Boolean(status.codex.authenticated),
						authMode: typeof status.codex.authMode === 'string' ? status.codex.authMode : null,
						planType: typeof status.codex.planType === 'string' ? status.codex.planType : null,
						models: Array.isArray(status.codex.models) ? status.codex.models : [],
					} : undefined,
				})
			})
			.catch(() => setAgentStatus(EMPTY_AGENT_STATUS))
	}, [agentEnabled])

	useEffect(() => {
		refreshAgentStatus()
	}, [refreshAgentStatus])

	useEffect(() => {
		if (!editor) return
		const updateSelection = () => {
			const shapes = editor.getCurrentPageShapes()
			setCanvasTitle(editor.getDocumentSettings().name || 'Untitled canvas')
			setPageShapeIds((current) => stableList(current, shapes.map((shape) => shape.id).sort()))
			setWidgetPointReferences((current) => stableList(current, dataWidgetPointReferences(shapes, workspace.connectedProfile?.alias).sort()))
			setDataWidgetCount(shapes.filter((shape) => shape.type === BAS_TABLE_SHAPE_TYPE || shape.type === BAS_TREND_SHAPE_TYPE).length)
		}
		updateSelection()
		// Document changes only: pointer moves, selection and camera are session scope.
		const stopDocument = editor.store.listen(updateSelection, { scope: 'document' })
		// The current page lives in session state, so page switches are observed separately.
		const stopPage = editor.sideEffects.registerAfterChangeHandler('instance', (previous, next) => {
			if (previous.currentPageId !== next.currentPageId) updateSelection()
		})
		return () => { stopDocument(); stopPage() }
	}, [editor, workspace.connectedProfile?.alias])

	// Built once per document/connection change. Live values travel through the snapshot
	// store, so a COV push re-renders only the shapes and widgets reading that point.
	const liveBindings = liveEffects && workspace.status === 'connected'
	const connectedAlias = workspace.connectedProfile?.alias
	const runtimeDocument = useMemo(() => ({
		...workspace.document,
		bindings: liveBindings ? workspace.document.bindings.filter((binding) => binding.enabled !== false && binding.stationAlias === connectedAlias) : [],
	}), [connectedAlias, liveBindings, workspace.document])
	const runtime = useMemo(() => ({
		document: runtimeDocument,
		connected: workspace.status === 'connected',
		stationAlias: connectedAlias || null,
		historySeries: workspace.historySeries,
		loadHistory: workspace.loadHistory,
		snapshotStore: workspace.snapshotStore,
	}), [connectedAlias, runtimeDocument, workspace.historySeries, workspace.loadHistory, workspace.snapshotStore, workspace.status])

	// Custom components that need the agent app's React context
	const components: TLComponents = useMemo(() => {
		return {
			TopPanel: null,
			StylePanel: ShellStylePanel,
			Toolbar: ShellToolbar,
			MenuPanel: ShellMenuPanel,
			NavigationPanel: ShellNavigationPanel,
			Dialogs: ShellDialogs,
			InFrontOfTheCanvas: PluginCanvasOverlays,
			ShapeWrapper: PluginShapeWrapper,
			HelperButtons: () =>
				app && (
					<TldrawAgentAppContextProvider app={app}>
						<CustomHelperButtons />
					</TldrawAgentAppContextProvider>
				),
		}
	}, [app])

	return (
		<ShellUiContext.Provider value={uiContainer}>
		<TldrawUiToastsProvider>
			<BasWorkspaceProvider workspace={workspace}>
				<PluginProviders>
					<BasRuntimeProvider value={runtime}>
						<div className={`bas-app-shell tl-theme__${colorMode} ${showAi ? 'ai-open' : ''}`}>
							<main className="canvas-workspace">
								<header className="canvas-header">
									<div className="canvas-header-identity"><div className="product-header"><div className="product-lockup"><div className="product-mark" aria-hidden="true"><span>~</span></div><h1>basdraw</h1></div><p>powered by tldraw</p></div>
									<div className="canvas-document-title">
										<strong>{canvasTitle}</strong>
										<span>{workspace.document.bindings.length} {workspace.document.bindings.length === 1 ? 'binding' : 'bindings'}{dataWidgetCount > 0 ? ` · ${dataWidgetCount} data ${dataWidgetCount === 1 ? 'shape' : 'shapes'}` : ''}</span>
									</div></div>
									<div ref={setHeaderContainer} className={`canvas-header-actions tl-container tl-theme__${colorMode}`} />
								</header>
								<div className="tldraw-canvas">
									<PluginAppPanels area="left" />
									<Tldraw
										licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY}
										persistenceKey={BASDRAW_PROJECT_ID}
										shapeUtils={shapeUtils}
										tools={tools}
										overlayUtils={overlayUtils}
										overrides={overrides}
										components={components}
										onMount={setEditor}
									>
										<ThemeSync onChange={setColorMode} />
										{headerContainer && createPortal(<ShellUiContainer>
											<TldrawUiButton type="icon" aria-label={liveEffects ? 'Stop live effects' : 'Play live effects'}
												tooltip={liveEffects ? 'Stop live effects' : 'Play live effects'}
												onClick={() => setLiveEffects((current) => !current)}>
												<TldrawUiButtonIcon icon={<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
													{liveEffects ? <rect x="6" y="6" width="12" height="12" rx="1" /> : <path d="M7 4.5v15L20 12z" />}
												</svg>} />
											</TldrawUiButton>
											<AccessModeMenu />
											<PluginManager />
											<TldrawUiButton type="normal" disabled={!agentEnabled}
												onClick={() => setShowAi((current) => !current)}>
												<span className="ai-status-dot" data-active={aiAvailable && agentEnabled} />
												<TldrawUiButtonLabel>{showAi ? 'Close agent' : policy.ai === 'off' ? 'AI off' : aiAvailable && agentEnabled ? 'Open agent' : 'Set up AI'}</TldrawUiButtonLabel>
											</TldrawUiButton>
										</ShellUiContainer>, headerContainer)}
										{agentEnabled && <TldrawAgentAppProvider accessPolicy={policy} onMount={setApp} onUnmount={handleUnmount} />}
										{/* Preserve the SDK UI context, with the dock as the popup container. */}
										{showAi && agentPluginEnabled && aiContainer && createPortal(
											<ShellUiContainer>
												{aiAvailable ? <ErrorBoundary fallback={ChatPanelFallback}>
													{app && <TldrawAgentAppContextProvider app={app}>
														<ChatPanel status={agentStatus} onClose={() => setShowAi(false)} />
													</TldrawAgentAppContextProvider>}
												</ErrorBoundary> : <AgentSetupPanel status={agentStatus} onRefresh={refreshAgentStatus} />}
											</ShellUiContainer>, aiContainer
										)}
									</Tldraw>
								</div>
							</main>
							{showAi && agentEnabled && (
								<div ref={setAiContainer} className={`tl-container bas-ai-dock tl-theme__${colorMode}`} />
							)}
							<div ref={setUiContainer} className={`tl-container bas-ui-layer tl-theme__${colorMode}`} />
						</div>
					</BasRuntimeProvider>
				</PluginProviders>
			</BasWorkspaceProvider>
		</TldrawUiToastsProvider>
		</ShellUiContext.Provider>
	)
}

function ThemeSync({ onChange }: { onChange: (colorMode: 'light' | 'dark') => void }) {
	const colorMode = useColorMode()

	useEffect(() => {
		onChange(colorMode)
	}, [colorMode, onChange])

	return null
}

export default App

function stableList(current: string[], next: string[]) {
	return current.length === next.length && current.every((value, index) => value === next[index]) ? current : next
}
