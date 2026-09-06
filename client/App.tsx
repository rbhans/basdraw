import { useCallback, useEffect, useMemo, useState } from 'react'
import {
	DefaultSizeStyle,
	Editor,
	ErrorBoundary,
	TLComponents,
	Tldraw,
	TldrawUiToastsProvider,
	TldrawUiButton,
	TldrawUiButtonLabel,
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
import { CustomHelperButtons } from './components/CustomHelperButtons'
import { AgentHighlightOverlayUtil } from './overlays/AgentHighlightOverlayUtil'
import { TargetAreaTool } from './tools/TargetAreaTool'
import { TargetShapeTool } from './tools/TargetShapeTool'
import { BasRuntimeProvider } from './bas/BasRuntimeContext'
import { BasWorkspaceProvider } from './bas/BasWorkspaceContext'
import { NiagaraPanel } from './bas/NiagaraPanel'
import { RuntimeBindingsOverlay } from './bas/RuntimeBindingsOverlay'
import { RuntimeShapeWrapper } from './bas/RuntimeShapeWrapper'
import { useBasWorkspace } from './bas/useBasWorkspace'
import {
	BAS_TABLE_SHAPE_TYPE,
	BAS_TREND_SHAPE_TYPE,
	dataWidgetPointReferences,
	dataWidgetShapeUtils,
	type BasTableShape,
	type BasTrendShape,
} from './bas/DataWidgetShapes'
import { DataShapeStylePanel } from './bas/DataShapeStylePanel'

import { DataToolbar } from './bas/DataToolbar'
import { PointDragProvider, CanvasPointDrop } from './bas/PointDrag'
import { installShapeIdentities } from './bas/shapeIdentity'
import { ShapeNavigationOverlay } from './bas/ShapeNavigationOverlay'

function CanvasOverlays() { return <><RuntimeBindingsOverlay /><CanvasPointDrop /><ShapeNavigationOverlay /></> }

// Customize tldraw's styles to play to the agent's strengths
DefaultSizeStyle.setDefaultValue('s')

// Custom tools for picking context items
const tools = [TargetShapeTool, TargetAreaTool]
const overlayUtils = [AgentHighlightOverlayUtil]
const overrides: TLUiOverrides = {
	translations: { en: { 'tool.bas-table': 'Equipment table', 'tool.bas-trend': 'Trend chart' } },
	tools: (editor, tools) => {
		return {
			...tools,
			'target-area': {
				id: 'target-area',
				label: 'Pick Area',
				kbd: 'c',
				icon: 'tool-frame',
				onSelect() {
					editor.setCurrentTool('target-area')
				},
			},
			'target-shape': {
				id: 'target-shape',
				label: 'Pick Shape',
				kbd: 's',
				icon: 'tool-frame',
				onSelect() {
					editor.setCurrentTool('target-shape')
				},
			},
		}
	},
}

function App() {
	const [app, setApp] = useState<TldrawAgentApp | null>(null)
	const [editor, setEditor] = useState<Editor | null>(null)
	const [colorMode, setColorMode] = useState<'light' | 'dark'>('light')
	const [canvasTitle, setCanvasTitle] = useState('Untitled canvas')
	const [aiAvailable, setAiAvailable] = useState(false)
	const [showAi, setShowAi] = useState(false)
	const [liveEffects, setLiveEffects] = useState(true)
	const [widgetPointReferences, setWidgetPointReferences] = useState<string[]>([])
	const [pageShapeIds, setPageShapeIds] = useState<string[]>([])
	const [dataWidgetCount, setDataWidgetCount] = useState(0)
	const workspace = useBasWorkspace(editor, widgetPointReferences, pageShapeIds)
	useEffect(() => editor ? installShapeIdentities(editor) : undefined, [editor])

	const handleUnmount = useCallback(() => {
		setApp(null)
	}, [])

	useEffect(() => {
		let cancelled = false
		void fetch('/agent/status')
			.then((response) => response.ok ? response.json() : null)
			.then((result: unknown) => {
				const configured = result && typeof result === 'object' && 'configured' in result
					? Boolean((result as { configured?: unknown }).configured)
					: false
				if (!cancelled) setAiAvailable(configured)
			})
			.catch(() => undefined)
		return () => { cancelled = true }
	}, [])

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
		return editor.store.listen(updateSelection, { scope: 'all' })
	}, [editor, workspace.connectedProfile?.alias])

	// Custom components that need the agent app's React context
	const components: TLComponents = useMemo(() => {
		return {
			TopPanel: () => <div className="bas-preview-control">
				<TldrawUiButton type="normal" isActive={liveEffects} aria-pressed={liveEffects}
					title="Pause live effects to arrange the saved artwork. Tables and charts stay connected."
					onClick={() => setLiveEffects((current) => !current)}>
					<TldrawUiButtonLabel>{liveEffects ? 'Live effects on' : 'Live effects paused'}</TldrawUiButtonLabel>
				</TldrawUiButton>
			</div>,
			StylePanel: DataShapeStylePanel,
			Toolbar: DataToolbar,
			InFrontOfTheCanvas: CanvasOverlays,
			ShapeWrapper: RuntimeShapeWrapper,
			HelperButtons: () =>
				app && (
					<TldrawAgentAppContextProvider app={app}>
						<CustomHelperButtons />
					</TldrawAgentAppContextProvider>
				),
		}
	}, [app, liveEffects])

	return (
		<TldrawUiToastsProvider>
			<BasWorkspaceProvider workspace={workspace}>
			<PointDragProvider>
			<BasRuntimeProvider value={{
				document: { ...workspace.document, bindings: liveEffects && workspace.status === 'connected' ? workspace.document.bindings.filter((binding) => binding.enabled !== false && binding.stationAlias === workspace.connectedProfile?.alias) : [] },
				connected: workspace.status === 'connected',
				stationAlias: workspace.connectedProfile?.alias || null,
				historySeries: workspace.historySeries,
				loadHistory: workspace.loadHistory,
				snapshots: workspace.snapshots,
			}}>
				<div className={`bas-app-shell tl-theme__${colorMode} ${showAi ? 'ai-open' : ''}`}>
					<NiagaraPanel workspace={workspace} />
					<main className="canvas-workspace">
						<header className="canvas-header">
							<div className="canvas-header-identity"><div className="product-header"><div className="product-lockup"><div className="product-mark" aria-hidden="true"><span>~</span></div><h1>basdraw</h1></div><p>powered by tldraw</p></div>
							<div className="canvas-document-title">
								<strong>{canvasTitle}</strong>
								<span>{workspace.document.bindings.length} {workspace.document.bindings.length === 1 ? 'binding' : 'bindings'}{dataWidgetCount > 0 ? ` · ${dataWidgetCount} data ${dataWidgetCount === 1 ? 'shape' : 'shapes'}` : ''}</span>
							</div></div>
							<button
								className="ai-toggle"
								disabled={!aiAvailable}
								title={aiAvailable ? 'Toggle AI canvas agent' : 'Add a model provider key to .dev.vars to enable the agent'}
								onClick={() => setShowAi((current) => !current)}
							>
								<span className="ai-status-dot" data-active={aiAvailable} />
								{showAi ? 'Close agent' : aiAvailable ? 'Open agent' : 'Agent off'}
							</button>
						</header>
						<div className="tldraw-canvas">
							<Tldraw
								licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY}
								persistenceKey="bas-whiteboard-canvas-v1"
								shapeUtils={dataWidgetShapeUtils}
								tools={tools}
								overlayUtils={overlayUtils}
								overrides={overrides}
								components={components}
								onMount={setEditor}
							>
								<ThemeSync onChange={setColorMode} />
								<TldrawAgentAppProvider onMount={setApp} onUnmount={handleUnmount} />
							</Tldraw>
						</div>
					</main>
					{showAi && aiAvailable && (
						<ErrorBoundary fallback={ChatPanelFallback}>
							{app && (
								<TldrawAgentAppContextProvider app={app}>
									<ChatPanel />
								</TldrawAgentAppContextProvider>
							)}
						</ErrorBoundary>
					)}
				</div>
			</BasRuntimeProvider>
			</PointDragProvider>
			</BasWorkspaceProvider>
		</TldrawUiToastsProvider>
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
