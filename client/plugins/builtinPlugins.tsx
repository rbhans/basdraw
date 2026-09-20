import type { TLShape } from 'tldraw'
import { AgentHighlightOverlayUtil } from '../overlays/AgentHighlightOverlayUtil'
import { TargetAreaTool } from '../tools/TargetAreaTool'
import { TargetShapeTool } from '../tools/TargetShapeTool'
import { BehaviorInspector } from '../bas/BehaviorInspector'
import { CanvasPointDrop, PointDragProvider } from '../bas/PointDrag'
import { DataShapeSettings, type DataShape } from '../bas/DataShapeSettings'
import { useDataShapeDialog } from '../bas/DataShapeDialog'
import { BAS_TABLE_SHAPE_TYPE, BAS_TREND_SHAPE_TYPE, dataWidgetShapeUtils } from '../bas/DataWidgetShapes'
import { NiagaraPanel } from '../bas/NiagaraPanel'
import { RuntimeBindingsOverlay } from '../bas/RuntimeBindingsOverlay'
import { RuntimeShapeDecorator } from '../bas/RuntimeShapeWrapper'
import { ShapeIdentityPanel } from '../bas/ShapeIdentityPanel'
import { ShapeNavigationOverlay } from '../bas/ShapeNavigationOverlay'
import { installShapeIdentities } from '../bas/shapeIdentity'
import { useWorkspace } from '../bas/BasWorkspaceContext'
import { useVectorPdfDialog } from '../bas/VectorPdfDialog'
import { useWebViewDialog, WebViewSettings } from '../bas/WebViewSettings'
import { WEB_VIEW_TYPE, WebViewShapeUtil, type WebViewShape } from '../bas/WebViewShape'
import { BasdrawPluginRegistry } from './registry'
import type { BasdrawPlugin, BasdrawToolbarGroup, BasdrawPluginCategory } from './types'
import { BaskstreamAgentConnectionProvider } from '../connections/baskstreamAgentAdapter'
import { knowledgeBundles } from '../../shared/knowledge/bundles'
import { initializeProjectIdentity } from '../knowledge/currentKnowledgeScope'
import { behaviorAgentCapabilities, dataWidgetAgentCapabilities, webViewAgentCapabilities } from '../bas/agentCapabilities'
import { RelationshipProperties, readRelationship, relationshipAgentCapabilities, useCreateRelationship } from '../relationships/relationships'

const categories = {
	core: { id: 'core', label: 'Core', order: 0 },
	connections: { id: 'connections', label: 'Connections', order: 100 },
	behaviors: { id: 'behaviors', label: 'Behaviors', order: 200 },
	data: { id: 'data', label: 'Data & charts', order: 300 },
	imports: { id: 'imports', label: 'Import & embed', order: 400 },
	ai: { id: 'ai', label: 'AI & references', order: 500 },
	systems: { id: 'systems', label: 'Systems & relationships', order: 350 },
} satisfies Record<string, BasdrawPluginCategory>

const icons = {
	table: <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M3 9h18M3 14h18M9 4v16" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>,
	trend: <svg viewBox="0 0 24 24"><path d="M3 4v16h18M6 15l4-6 4 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>,
	pdf: <svg viewBox="0 0 24 24"><path d="M14 3H5v18h14V8zM14 3v5h5M8 13h8M8 17h5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>,
	web: <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M3 9h18M6 6.5h.01M9 6.5h.01" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>,
	relationship: <svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.5"/><circle cx="18" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.5"/><path d="M9 12h6m-2-2 2 2-2 2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
}

const dataGroup: BasdrawToolbarGroup = { id: 'data', label: 'Data', icon: icons.trend, order: 100 }
const importGroup: BasdrawToolbarGroup = { id: 'import-embed', label: 'Import & embed', icon: icons.pdf, order: 200 }
const systemsGroup: BasdrawToolbarGroup = { id: 'systems', label: 'Systems', icon: icons.relationship, order: 300 }

function useAddTable() { const open = useDataShapeDialog(); return () => open('table') }
function useAddTrend() { const open = useDataShapeDialog(); return () => open('trend') }
function useImportPdf() { return useVectorPdfDialog() }
function useAddWebView() { return useWebViewDialog() }
function RelationshipPropertiesContribution({ shape }: { shape: TLShape }) { return <RelationshipProperties shape={shape} /> }

function DataProperties({ shape }: { shape: TLShape }) { return <DataShapeSettings shape={shape as DataShape} /> }
function WebViewProperties({ shape }: { shape: TLShape }) { return <WebViewSettings shape={shape as WebViewShape} /> }
function IdentityProperties({ shape }: { shape: TLShape }) { return <ShapeIdentityPanel shape={shape} /> }
function BehaviorProperties({ shape }: { shape: TLShape }) { return <BehaviorInspector shape={shape} /> }
function NiagaraPanelContribution() { return <NiagaraPanel workspace={useWorkspace()} /> }

const identityPlugin: BasdrawPlugin = {
	category: categories.core,
	id: 'shape-identity', version: '1.0.0', label: 'Shape identity', alwaysEnabled: true,
	description: 'Stable names and identities used by navigation, relationships and AI context.',
	propertySections: [{ id: 'shape-identity', order: 100, supports: () => true, component: IdentityProperties }],
	onEditorMount: (editor) => {
		const stopProjectIdentity = initializeProjectIdentity(editor)
		const stopShapeIdentities = installShapeIdentities(editor)
		return () => { stopProjectIdentity(); stopShapeIdentities() }
	},
}

const baskstreamPlugin: BasdrawPlugin = {
	category: categories.connections,
	id: 'niagara-baskstream', version: '1.0.0', label: 'Niagara via baskStream', defaultEnabled: true,
	description: 'Connects the canvas to Niagara stations through the local baskStream bridge.',
	providers: [
		{ id: 'baskstream-point-drag', order: 100, component: PointDragProvider },
		{ id: 'baskstream-agent-connection', order: 110, component: BaskstreamAgentConnectionProvider },
	],
	appPanels: [{ id: 'baskstream-station-points', area: 'left', order: 100, component: NiagaraPanelContribution }],
	canvasOverlays: [{ id: 'baskstream-point-drop', order: 100, component: CanvasPointDrop }],
	connection: {
		type: 'baskstream', label: 'Niagara via baskStream',
		capabilities: ['browse', 'search', 'read', 'subscribe', 'read_history', 'read_schedule', 'read_alarms', 'read_tags'],
		references: ['baskstream-api'],
	},
	agent: { actions: ['connectionTool'], promptParts: ['connections'], references: ['baskstream-api'] },
}

const behaviorsPlugin: BasdrawPlugin = {
	category: categories.behaviors,
	id: 'live-behaviors', version: '1.0.0', label: 'Live behaviors', defaultEnabled: true,
	description: 'Data-driven shape appearance, values, movement and navigation.',
	dependencies: ['shape-identity'],
	propertySections: [{ id: 'live-behaviors', order: 900, supports: () => true, component: BehaviorProperties }],
	shapeDecorators: [{ id: 'live-behavior-transforms', order: 100, component: RuntimeShapeDecorator }],
	canvasOverlays: [
		{ id: 'live-behavior-overlays', order: 200, component: RuntimeBindingsOverlay },
		{ id: 'shape-navigation', order: 300, component: ShapeNavigationOverlay },
	],
	agent: { references: ['basdraw-behaviors'], canvasCapabilities: behaviorAgentCapabilities },
}

const dataWidgetsPlugin: BasdrawPlugin = {
	category: categories.data,
	id: 'data-widgets', version: '1.0.0', label: 'Tables and charts', defaultEnabled: true,
	description: 'Equipment tables and live trend charts.',
	tldraw: {
		shapeUtils: dataWidgetShapeUtils,
		translations: { 'tool.bas-table': 'Equipment table', 'tool.bas-trend': 'Trend chart' },
	},
	toolbarItems: [
		{ id: 'bas-table', group: dataGroup, label: 'tool.bas-table', icon: icons.table, order: 100, useSelect: useAddTable },
		{ id: 'bas-trend', group: dataGroup, label: 'tool.bas-trend', icon: icons.trend, order: 200, useSelect: useAddTrend },
	],
	propertySections: [{ id: 'data-widget-settings', order: 300, supports: (shape) => shape.type === BAS_TABLE_SHAPE_TYPE || shape.type === BAS_TREND_SHAPE_TYPE, component: DataProperties }],
	agent: { references: ['basdraw-data-widgets'], canvasCapabilities: dataWidgetAgentCapabilities },
}

const vectorPdfPlugin: BasdrawPlugin = {
	category: categories.imports,
	id: 'vector-pdf', version: '1.0.0', label: 'Vector PDF import', defaultEnabled: true,
	description: 'Imports vector PDF pages as editable canvas artwork.',
	tldraw: { translations: { 'tool.bas-import-pdf': 'Import vector PDF' } },
	toolbarItems: [{ id: 'bas-import-pdf', group: importGroup, label: 'tool.bas-import-pdf', icon: icons.pdf, order: 100, useSelect: useImportPdf }],
	agent: { references: ['basdraw-vector-pdf'] },
}

const webViewPlugin: BasdrawPlugin = {
	category: categories.imports,
	id: 'web-view', version: '1.0.0', label: 'Web View', defaultEnabled: true,
	description: 'Places an interactive web surface on the canvas.',
	tldraw: { shapeUtils: [WebViewShapeUtil], translations: { 'tool.bas-web-view': 'Web View' } },
	toolbarItems: [{ id: 'bas-web-view', group: importGroup, label: 'tool.bas-web-view', icon: icons.web, order: 200, useSelect: useAddWebView }],
	propertySections: [{ id: 'web-view-settings', order: 300, supports: (shape) => shape.type === WEB_VIEW_TYPE, component: WebViewProperties }],
	agent: { references: ['basdraw-web-view'], canvasCapabilities: webViewAgentCapabilities },
}

const relationshipPlugin: BasdrawPlugin = {
	category: categories.systems,
	id: 'relationship-map', version: '1.0.0', label: 'Canvas relationships', defaultEnabled: true,
	description: 'Connects existing canvas items with native tldraw arrows and lightweight relationship metadata.',
	dependencies: ['shape-identity'],
	toolbarItems: [{ id: 'bas-relationship', group: systemsGroup, label: 'Connect selected shapes', icon: icons.relationship, order: 100, useSelect: useCreateRelationship }],
	propertySections: [{ id: 'relationship-settings', order: 400, supports: (shape) => Boolean(readRelationship(shape)), component: RelationshipPropertiesContribution }],
	agent: { references: ['basdraw:relationships'], canvasCapabilities: relationshipAgentCapabilities },
}

const agentPlugin: BasdrawPlugin = {
	category: categories.ai,
	id: 'canvas-agent', version: '1.0.0', label: 'Canvas AI', defaultEnabled: true,
	description: 'tldraw Agent Starter Kit canvas understanding and editing tools.',
	tldraw: {
		tools: [TargetShapeTool, TargetAreaTool], overlayUtils: [AgentHighlightOverlayUtil],
		uiTools: [
			{ id: 'target-area', create: (editor) => ({ id: 'target-area', label: 'Pick Area', kbd: 'c', icon: 'tool-frame', onSelect: () => editor.setCurrentTool('target-area') }) },
			{ id: 'target-shape', create: (editor) => ({ id: 'target-shape', label: 'Pick Shape', kbd: 's', icon: 'tool-frame', onSelect: () => editor.setCurrentTool('target-shape') }) },
		],
	},
	agent: { references: ['tldraw-agent-starter'] },
}

export const builtinPlugins: readonly BasdrawPlugin[] = [identityPlugin, baskstreamPlugin, behaviorsPlugin, dataWidgetsPlugin, vectorPdfPlugin, webViewPlugin, relationshipPlugin, agentPlugin].map((plugin) => ({
	...plugin, knowledge: knowledgeBundles.find((bundle) => bundle.pluginId === plugin.id),
}))
export const pluginRegistry = new BasdrawPluginRegistry(builtinPlugins)
