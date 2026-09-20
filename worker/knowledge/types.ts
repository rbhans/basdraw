export type { KnowledgeKind, KnowledgeScopeType, KnowledgeEntry } from '../../shared/knowledge'

export type KnowledgeContextScope = {
	projectId?: string | null
	connectionId?: string | null
	pluginIds?: readonly string[]
	connectionIds?: readonly string[]
	connectionTypes?: readonly string[]
}
