import type { BasdrawPluginCategory, BasdrawPluginManifest } from './types'

// Descriptor metadata for the built-in plugins. React-free so dependency and context
// rules can be verified in Node (scripts/plugin-dependencies.test.mjs). builtinPlugins.tsx
// adds the UI contributions to these entries.

export const pluginCategories = {
	core: { id: 'core', label: 'Core', order: 0 },
	connections: { id: 'connections', label: 'Connections', order: 100 },
	behaviors: { id: 'behaviors', label: 'Behaviors', order: 200 },
	data: { id: 'data', label: 'Data & charts', order: 300 },
	imports: { id: 'imports', label: 'Import & embed', order: 400 },
	ai: { id: 'ai', label: 'AI & references', order: 500 },
	systems: { id: 'systems', label: 'Systems & relationships', order: 350 },
} satisfies Record<string, BasdrawPluginCategory>

/** React contexts owned by plugins. Host contexts are listed in registry.ts (HOST_CONTEXTS). */
export const PLUGIN_CONTEXTS = {
	pointDrag: 'point-drag',
} as const

export const builtinPluginManifest = {
	identity: {
		category: pluginCategories.core,
		id: 'shape-identity', version: '1.0.0', label: 'Shape identity', alwaysEnabled: true,
		description: 'Stable names and identities used by navigation, relationships and AI context.',
		contexts: { requires: ['tldraw-editor'] },
	},
	baskstream: {
		category: pluginCategories.connections,
		id: 'niagara-baskstream', version: '1.0.0', label: 'Niagara via baskStream', defaultEnabled: true,
		description: 'Connects the canvas to Niagara stations through the local baskStream bridge.',
		contexts: { provides: [PLUGIN_CONTEXTS.pointDrag], requires: ['bas-workspace', 'tldraw-editor'] },
	},
	behaviors: {
		category: pluginCategories.behaviors,
		id: 'live-behaviors', version: '1.0.0', label: 'Live behaviors', defaultEnabled: true,
		description: 'Data-driven shape appearance, values, movement and navigation.',
		dependencies: ['shape-identity'],
		// Saved behaviors still edit and render offline; drag-to-bind needs the connection's point drag.
		optionalDependencies: ['niagara-baskstream'],
		contexts: { requires: ['bas-workspace', 'bas-runtime', 'tldraw-editor'], optional: [PLUGIN_CONTEXTS.pointDrag] },
	},
	dataWidgets: {
		category: pluginCategories.data,
		id: 'data-widgets', version: '1.0.0', label: 'Tables and charts', defaultEnabled: true,
		description: 'Equipment tables and live trend charts.',
		optionalDependencies: ['niagara-baskstream'],
		contexts: { requires: ['bas-workspace', 'bas-runtime', 'tldraw-editor'] },
	},
	vectorPdf: {
		category: pluginCategories.imports,
		id: 'vector-pdf', version: '1.0.0', label: 'Vector PDF import', defaultEnabled: true,
		description: 'Imports vector PDF pages as editable canvas artwork.',
		// Indexes the original PDF for AI only when document understanding is enabled.
		optionalDependencies: ['document-understanding'],
		contexts: { requires: ['basdraw-plugins', 'tldraw-editor'] },
	},
	documents: {
		category: pluginCategories.imports,
		id: 'document-understanding', version: '1.0.0', label: 'Document understanding', defaultEnabled: true,
		description: 'Automatically read PDFs, scans, images, Word documents, spreadsheets and text for canvas AI.',
		optionalDependencies: ['vector-pdf'],
		contexts: { requires: ['tldraw-editor', 'toasts'] },
	},
	webView: {
		category: pluginCategories.imports,
		id: 'web-view', version: '1.0.0', label: 'Web View', defaultEnabled: true,
		description: 'Places an interactive web surface on the canvas.',
		contexts: { requires: ['tldraw-editor'] },
	},
	relationships: {
		category: pluginCategories.systems,
		id: 'relationship-map', version: '1.0.0', label: 'Canvas relationships', defaultEnabled: true,
		description: 'Connects existing canvas items with native tldraw arrows and lightweight relationship metadata.',
		dependencies: ['shape-identity'],
		contexts: { requires: ['tldraw-editor', 'toasts'] },
	},
	agent: {
		category: pluginCategories.ai,
		id: 'canvas-agent', version: '1.0.0', label: 'Canvas AI', defaultEnabled: true,
		description: 'tldraw Agent Starter Kit canvas understanding and editing tools.',
		contexts: { requires: ['tldraw-editor', 'access-policy'] },
	},
} satisfies Record<string, BasdrawPluginManifest>
