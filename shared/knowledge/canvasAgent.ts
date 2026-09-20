import type { PluginKnowledgeBundle } from '../knowledge'

export const canvasAgentKnowledge: PluginKnowledgeBundle = {
	pluginId: 'canvas-agent',
	version: '1.0.0',
	entries: [
		{
			id: 'basdraw:canvas-composition', kind: 'skill',
			title: 'Compose and revise a basdraw canvas',
			description: 'Use when analyzing, organizing or editing a basdraw canvas with native tldraw actions and plugin capabilities.',
			referenceIds: ['tldraw-agent-starter'],
			content: `Inspect the visible and selected canvas before editing. Treat shape IDs as immutable identities and preserve unrelated content, pages, groups, bindings and metadata.
Use core canvas actions for ordinary tldraw shapes, layout and presentation. Plugin-supplied shapes are described with their subtype, name, bounds and bounded props. Use only the exact enabled plugin capability IDs and operations in the current prompt to create or configure plugin content.
Prefer a small number of clear operations. Reuse existing shapes when the request is a revision. Keep data-heavy content in native tables, trends and behaviors rather than drawing a visual imitation. Use exact point references returned by a connection; never infer an ORD from a label.
Relationships are explanatory canvas structure, not station wires or commands. Use relationship capabilities only when the user asks to express a relationship.
Honor the current access policy. Analysis mode may inspect and explain but must not edit. Connection writes require the separate approval shown by the app. After a capability error, correct the arguments from the declared contract instead of changing unrelated content.`,
		},
		{
			id: 'tldraw-agent-starter', kind: 'reference',
			title: 'Canvas action conventions',
			description: 'How the basdraw agent combines tldraw actions with optional plugin capabilities.',
			content: `The core action set creates and edits supported tldraw shapes, arranges content, changes the viewport and asks questions. The pluginContent action is an extension boundary: pluginId, capabilityId and operation must match the current capability catalog. Arguments are plugin-owned and validated at runtime.
Unknown shapes are installed plugin shapes. Their prompt representation is descriptive, not a creation schema. Use their matching plugin capability for domain configuration. Core transforms may still move, resize or delete an existing unknown shape.
The current prompt and runtime are authoritative. Installed plugins can be disabled per user preference while their shape utilities remain registered so existing documents stay readable.`,
		},
	],
}

export const behaviorKnowledge: PluginKnowledgeBundle = {
	pluginId: 'live-behaviors', version: '1.0.0',
	entries: [{ id: 'basdraw-behaviors', kind: 'reference', title: 'Live behavior reference', description: 'Data-driven shape behavior model.', content: `A shape may have multiple behaviors driven by multiple points. Behaviors are stored in shape metadata and have stable binding IDs. Runtime properties are fill, levelFill, label, visibility, opacity, rotation, scale and movement. Enabled behaviors may coexist unless they own the same runtime channel; movement on x and y are separate channels. Use inspected binding IDs for updates and deletes. Keep exact station aliases and point references. The plugin capability validates mappings, property-specific options and conflicts.` }],
}

export const dataWidgetKnowledge: PluginKnowledgeBundle = {
	pluginId: 'data-widgets', version: '1.0.0',
	entries: [{ id: 'basdraw-data-widgets', kind: 'reference', title: 'Tables and trend charts', description: 'Native BAS data widget contracts.', content: `Tables group verified points by equipmentReference rows and fieldKey columns. Every point keeps its exact reference and display labels. Trends contain explicit pointReference, pointLabel and hex color series plus a time range and line mode. Both shapes keep a stationAlias and independent frame size/content scale. Use the data widget capability instead of drawing a table or chart from primitive shapes.` }],
}

export const vectorPdfKnowledge: PluginKnowledgeBundle = {
	pluginId: 'vector-pdf', version: '1.0.0',
	entries: [{ id: 'basdraw-vector-pdf', kind: 'reference', title: 'Vector PDF import', description: 'Editable vector control drawing import.', content: `Vector PDF pages are imported as ordinary editable tldraw artwork. Imported groups and primitives may be rearranged or given live behaviors. Scanned/raster PDFs do not become editable symbols. Preserve grouping and drawing fidelity unless the user asks to restructure the import.` }],
}

export const webViewKnowledge: PluginKnowledgeBundle = {
	pluginId: 'web-view', version: '1.0.0',
	entries: [{ id: 'basdraw-web-view', kind: 'reference', title: 'Web view', description: 'Sandboxed canvas web surface.', content: `A web view embeds one HTTP or HTTPS address in a sandboxed custom shape. Credentials may not be embedded in its URL. Frame size and content scale are independent. Cross-origin pages may refuse iframe embedding and their pixels cannot be included in canvas SVG export. Use only when the user asks to embed or display a web page.` }],
}
