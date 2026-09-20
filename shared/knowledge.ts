export const BASDRAW_PROJECT_ID = 'bas-whiteboard-canvas-v1'

export type AgentKnowledgeScope = {
	projectId: string | null
	connectionId: string | null
	pluginIds: string[]
	connectionIds?: string[]
	connectionTypes?: string[]
}

export type KnowledgeKind = 'skill' | 'reference'
export type KnowledgeScopeType = 'global' | 'project' | 'connection'
export type KnowledgeEntry = {
	id: string
	kind: KnowledgeKind
	title: string
	description: string
	content: string
	scopeType: KnowledgeScopeType
	scopeId: string | null
	enabled: boolean
	priority: number
	source: string
	pluginId: string | null
	tags: string[]
	createdAt: number
	updatedAt: number
}

/** Portable plugin instructions. Tools and credentials stay in the adapter. */
export type PluginKnowledgeBundle = {
	pluginId: string
	version: string
	connectionTypes?: readonly string[]
	entries: readonly {
		id: string
		kind: KnowledgeKind
		title: string
		description: string
		content: string
		referenceIds?: readonly string[]
	}[]
}

export type KnowledgeRequest = {
	operation: 'catalog' | 'loadSkill' | 'getReference' | 'search'
	id?: string
	query?: string
	projectOnly?: boolean
	offset?: number
}
