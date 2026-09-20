import type { AgentKnowledgeScope } from '../../shared/knowledge'
import type { Editor } from 'tldraw'
import { BASDRAW_PROJECT_ID } from '../../shared/knowledge'
import { connectionRuntime } from '../connections/ConnectionRuntime'

let currentScope: AgentKnowledgeScope = { projectId: null, connectionId: null, pluginIds: [] }

export function setCurrentKnowledgeScope(scope: AgentKnowledgeScope) {
	currentScope = { ...scope, pluginIds: [...scope.pluginIds] }
}

export function getCurrentKnowledgeScope(editor?: Editor): AgentKnowledgeScope {
	const adapters = connectionRuntime.describe()
	const connections = adapters.filter((connection) => connection.connected)
	return {
		...currentScope,
		connectionId: null,
		projectId: editor ? getProjectId(editor) : currentScope.projectId,
		pluginIds: [...currentScope.pluginIds],
		connectionIds: [...new Set(connections.flatMap((connection) => connection.knowledgeScopeIds ?? [connection.id]))],
		connectionTypes: [...new Set(adapters.map((connection) => connection.type))],
	}
}

export function getProjectId(editor: Editor) {
	const id = editor.getDocumentSettings().meta.basdrawProjectId
	return typeof id === 'string' && id.trim() ? id : BASDRAW_PROJECT_ID
}

/** Preserve the original project's knowledge when upgrading existing canvases. */
export function initializeProjectIdentity(editor: Editor) {
	const document = editor.getDocumentSettings()
	if (!document.meta.basdrawProjectId) {
		editor.updateDocumentSettings({ meta: { ...document.meta, basdrawProjectId: BASDRAW_PROJECT_ID } })
	}
	// Opening a new/imported document without an identity starts a separate project.
	// Files already containing an identity retain their existing association.
	return editor.store.listen(() => {
		const current = editor.getDocumentSettings()
		if (!current.meta.basdrawProjectId) {
			editor.updateDocumentSettings({ meta: { ...current.meta, basdrawProjectId: crypto.randomUUID() } })
		}
	}, { scope: 'document' })
}
