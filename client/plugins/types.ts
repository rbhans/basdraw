import type {
	Editor,
	JsonValue,
	TLAnyBindingUtilConstructor,
	TLAnyShapeUtilConstructor,
	TLOverlayUtilConstructor,
	TLShape,
	TLStateNodeConstructor,
	TLUiIconJsx,
	TLUiToolItem,
} from 'tldraw'
import type { ComponentType, ReactNode } from 'react'
import type { PluginKnowledgeBundle } from '../../shared/knowledge'

export type BasdrawPluginId = string
export type BasdrawPluginCategory = { id: string; label: string; order: number }
export type BasdrawToolbarGroupId = string

export type BasdrawToolbarGroup = {
	id: BasdrawToolbarGroupId
	label: string
	icon: TLUiIconJsx
	order: number
}

export type BasdrawToolbarItem = {
	id: string
	group: BasdrawToolbarGroup
	label: string
	icon: TLUiIconJsx
	order: number
	useSelect: () => () => void
}

export type BasdrawPropertySection = {
	id: string
	order: number
	supports: (shape: TLShape) => boolean
	component: ComponentType<{ shape: TLShape }>
}

export type BasdrawShapeDecorator = ComponentType<{ shape: TLShape; children: ReactNode }>
export type BasdrawCanvasOverlay = ComponentType
export type BasdrawProvider = ComponentType<{ children: ReactNode }>
export type BasdrawAppPanel = ComponentType

export type BasdrawAgentContribution = {
	actions?: readonly string[]
	promptParts?: readonly string[]
	references?: readonly string[]
	canvasCapabilities?: readonly BasdrawAgentCanvasCapability[]
}

export type BasdrawAgentCanvasOperation = 'create' | 'update' | 'delete'

export type BasdrawAgentCanvasCapability = {
	id: string
	title: string
	description: string
	operations: readonly BasdrawAgentCanvasOperation[]
	/** Human-readable, model-facing argument contract. Runtime validation remains authoritative. */
	inputSchema: Readonly<Record<string, string>>
	/** Return bounded structured information for matching shapes in the current viewport. */
	inspect?: (editor: Editor, shape: TLShape) => JsonValue | null
	execute: (context: {
		editor: Editor
		operation: BasdrawAgentCanvasOperation
		shapeId: string | null
		position: { x: number; y: number } | null
		arguments: Record<string, JsonValue>
	}) => JsonValue | void
}

export type BasdrawConnectionContribution = {
	type: string
	label: string
	capabilities: readonly string[]
	references?: readonly string[]
}

export type BasdrawPlugin = {
	id: BasdrawPluginId
	category: BasdrawPluginCategory
	version: string
	label: string
	description: string
	defaultEnabled?: boolean
	alwaysEnabled?: boolean
	/** Required plugins. Enabling this plugin enables them; disabling one disables this plugin. */
	dependencies?: readonly BasdrawPluginId[]
	/** Plugins this one enhances when present and must work without (e.g. drag-to-bind from a connection). */
	optionalDependencies?: readonly BasdrawPluginId[]
	/**
	 * React contexts this plugin provides or consumes. A required context must come from the
	 * host or a declared dependency; an optional one must have a no-provider fallback hook.
	 */
	contexts?: BasdrawPluginContexts
	tldraw?: {
		shapeUtils?: readonly TLAnyShapeUtilConstructor[]
		bindingUtils?: readonly TLAnyBindingUtilConstructor[]
		tools?: readonly TLStateNodeConstructor[]
		overlayUtils?: readonly TLOverlayUtilConstructor[]
		uiTools?: readonly { id: string; create: (editor: Editor) => TLUiToolItem }[]
		translations?: Readonly<Record<string, string>>
	}
	toolbarItems?: readonly BasdrawToolbarItem[]
	propertySections?: readonly BasdrawPropertySection[]
	shapeDecorators?: readonly { id: string; order: number; component: BasdrawShapeDecorator }[]
	canvasOverlays?: readonly { id: string; order: number; component: BasdrawCanvasOverlay }[]
	providers?: readonly { id: string; order: number; component: BasdrawProvider }[]
	appPanels?: readonly { id: string; area: 'left' | 'right'; order: number; component: BasdrawAppPanel }[]
	agent?: BasdrawAgentContribution
	knowledge?: PluginKnowledgeBundle
	connection?: BasdrawConnectionContribution
	onEditorMount?: (editor: Editor) => void | (() => void)
}

export type BasdrawPluginContexts = {
	provides?: readonly string[]
	requires?: readonly string[]
	optional?: readonly string[]
}

/** Serializable descriptor fields, kept free of React so dependency rules are testable in Node. */
export type BasdrawPluginManifest = Pick<BasdrawPlugin, 'id' | 'category' | 'version' | 'label' | 'description' | 'defaultEnabled' | 'alwaysEnabled' | 'dependencies' | 'optionalDependencies' | 'contexts'>

export type BasdrawPluginPreferences = {
	disabled: readonly BasdrawPluginId[]
	enabled: readonly BasdrawPluginId[]
}

export type BasdrawDocumentPluginRequirement = {
	id: BasdrawPluginId
	version: string
}
