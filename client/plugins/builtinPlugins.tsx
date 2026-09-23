import { lazy, Suspense } from 'react'
import { TldrawUiDialogBody, useDialogs, type TLShape, type TLUiDialogProps } from 'tldraw'
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
import { useWebViewDialog, WebViewSettings } from '../bas/WebViewSettings'
import { WEB_VIEW_TYPE, WebViewShapeUtil, type WebViewShape } from '../bas/WebViewShape'
import { BasdrawPluginRegistry } from './registry'
import type { BasdrawPlugin, BasdrawToolbarGroup } from './types'
import { builtinPluginManifest as manifest } from './pluginManifest'
import { BaskstreamAgentConnectionProvider } from '../connections/baskstreamAgentAdapter'
import { knowledgeBundles } from '../../shared/knowledge/bundles'
import { initializeProjectIdentity } from '../knowledge/currentKnowledgeScope'
import { behaviorAgentCapabilities, dataWidgetAgentCapabilities, webViewAgentCapabilities } from '../bas/agentCapabilities'
import { RelationshipProperties, readRelationship, relationshipAgentCapabilities, useCreateRelationship } from '../relationships/relationships'
import { DocumentShapeUtil, DocumentProperties, DocumentNotifications, useImportDocument } from '../documents/DocumentShape'

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
// The PDF dialog (and its vector splitter) loads on first use, shared with the document plugin's lazy import.
const LazyVectorPdfDialog = lazy(() => import('../bas/VectorPdfDialog').then((module) => ({ default: module.VectorPdfDialog })))
function VectorPdfDialogLoader(props: TLUiDialogProps) {
	return <Suspense fallback={<TldrawUiDialogBody>Loading PDF import…</TldrawUiDialogBody>}><LazyVectorPdfDialog {...props} /></Suspense>
}
function useImportPdf() {
	const { addDialog } = useDialogs()
	return () => { addDialog({ id: 'bas-import-pdf', component: VectorPdfDialogLoader }) }
}
function useAddWebView() { return useWebViewDialog() }
function RelationshipPropertiesContribution({ shape }: { shape: TLShape }) { return <RelationshipProperties shape={shape} /> }

function DataProperties({ shape }: { shape: TLShape }) { return <DataShapeSettings shape={shape as DataShape} /> }
function WebViewProperties({ shape }: { shape: TLShape }) { return <WebViewSettings shape={shape as WebViewShape} /> }
function IdentityProperties({ shape }: { shape: TLShape }) { return <ShapeIdentityPanel shape={shape} /> }
function BehaviorProperties({ shape }: { shape: TLShape }) { return <BehaviorInspector shape={shape} /> }
function NiagaraPanelContribution() { return <NiagaraPanel workspace={useWorkspace()} /> }

const identityPlugin: BasdrawPlugin = {
	...manifest.identity,
	propertySections: [{ id: 'shape-identity', order: 100, supports: () => true, component: IdentityProperties }],
	onEditorMount: (editor) => {
		const stopProjectIdentity = initializeProjectIdentity(editor)
		const stopShapeIdentities = installShapeIdentities(editor)
		return () => { stopProjectIdentity(); stopShapeIdentities() }
	},
}

const baskstreamPlugin: BasdrawPlugin = {
	...manifest.baskstream,
	providers: [
		{ id: 'baskstream-point-drag', order: 100, component: PointDragProvider },
		{ id: 'baskstream-agent-connection', order: 110, component: BaskstreamAgentConnectionProvider },
	],
	appPanels: [{ id: 'baskstream-station-points', area: 'left', order: 100, component: NiagaraPanelContribution }],
	canvasOverlays: [{ id: 'baskstream-point-drop', order: 100, component: CanvasPointDrop }],
	connection: {
		type: 'baskstream', label: 'Niagara via baskStream',
		capabilities: ['browse', 'search', 'read', 'subscribe', 'read_history', 'read_schedule', 'read_alarms', 'read_tags', 'describe_write', 'write', 'write_tags', 'write_relations', 'ack_alarm', 'ack_alarms', 'clear_alarm', 'clear_alarms'],
		references: ['baskstream-api'],
	},
	agent: { actions: ['connectionTool'], promptParts: ['connections'], references: ['baskstream-api'] },
}

const behaviorsPlugin: BasdrawPlugin = {
	...manifest.behaviors,
	propertySections: [{ id: 'live-behaviors', order: 900, supports: () => true, component: BehaviorProperties }],
	shapeDecorators: [{ id: 'live-behavior-transforms', order: 100, component: RuntimeShapeDecorator }],
	canvasOverlays: [
		{ id: 'live-behavior-overlays', order: 200, component: RuntimeBindingsOverlay },
		{ id: 'shape-navigation', order: 300, component: ShapeNavigationOverlay },
	],
	agent: { references: ['basdraw-behaviors'], canvasCapabilities: behaviorAgentCapabilities },
}

const dataWidgetsPlugin: BasdrawPlugin = {
	...manifest.dataWidgets,
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
	...manifest.vectorPdf,
	tldraw: { translations: { 'tool.bas-import-pdf': 'Import vector PDF' } },
	toolbarItems: [{ id: 'bas-import-pdf', group: importGroup, label: 'tool.bas-import-pdf', icon: icons.pdf, order: 100, useSelect: useImportPdf }],
	agent: { references: ['basdraw-vector-pdf'] },
}

const documentsPlugin: BasdrawPlugin = {
	...manifest.documents,
	tldraw: { shapeUtils: [DocumentShapeUtil], translations: { 'tool.bas-document': 'Document' } },
	toolbarItems: [{ id: 'bas-document', group: importGroup, label: 'Import document', icon: icons.pdf, order: 50, useSelect: useImportDocument }],
	propertySections: [{ id: 'document-source', order: 350, supports: shape => shape.type === 'bas-document' || shape.type === 'image' || Boolean(shape.meta.basDocumentAssetId), component: DocumentProperties }],
	canvasOverlays: [{ id: 'document-notifications', order: 500, component: DocumentNotifications }],
	agent: { references: ['basdraw:documents'] },
}

const webViewPlugin: BasdrawPlugin = {
	...manifest.webView,
	tldraw: { shapeUtils: [WebViewShapeUtil], translations: { 'tool.bas-web-view': 'Web View' } },
	toolbarItems: [{ id: 'bas-web-view', group: importGroup, label: 'tool.bas-web-view', icon: icons.web, order: 200, useSelect: useAddWebView }],
	propertySections: [{ id: 'web-view-settings', order: 300, supports: (shape) => shape.type === WEB_VIEW_TYPE, component: WebViewProperties }],
	agent: { references: ['basdraw-web-view'], canvasCapabilities: webViewAgentCapabilities },
}

const relationshipPlugin: BasdrawPlugin = {
	...manifest.relationships,
	toolbarItems: [{ id: 'bas-relationship', group: systemsGroup, label: 'Connect selected shapes', icon: icons.relationship, order: 100, useSelect: useCreateRelationship }],
	propertySections: [{ id: 'relationship-settings', order: 400, supports: (shape) => Boolean(readRelationship(shape)), component: RelationshipPropertiesContribution }],
	agent: { references: ['basdraw:relationships'], canvasCapabilities: relationshipAgentCapabilities },
}

const agentPlugin: BasdrawPlugin = {
	...manifest.agent,
	tldraw: {
		tools: [TargetShapeTool, TargetAreaTool], overlayUtils: [AgentHighlightOverlayUtil],
		uiTools: [
			{ id: 'target-area', create: (editor) => ({ id: 'target-area', label: 'Pick Area', kbd: 'c', icon: 'tool-frame', onSelect: () => editor.setCurrentTool('target-area') }) },
			{ id: 'target-shape', create: (editor) => ({ id: 'target-shape', label: 'Pick Shape', kbd: 's', icon: 'tool-frame', onSelect: () => editor.setCurrentTool('target-shape') }) },
		],
	},
	agent: { references: ['tldraw-agent-starter'] },
}

export const builtinPlugins: readonly BasdrawPlugin[] = [identityPlugin, baskstreamPlugin, behaviorsPlugin, dataWidgetsPlugin, vectorPdfPlugin, documentsPlugin, webViewPlugin, relationshipPlugin, agentPlugin].map((plugin) => ({
	...plugin, knowledge: knowledgeBundles.find((bundle) => bundle.pluginId === plugin.id),
}))
export const pluginRegistry = new BasdrawPluginRegistry(builtinPlugins)
