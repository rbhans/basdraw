import type { DocumentsPart } from '../../shared/schema/PromptPartDefinitions'
import type { AgentRequest } from '../../shared/types/AgentRequest'
import { getCurrentKnowledgeScope } from '../knowledge/currentKnowledgeScope'
import { documentIndexState, readCanvasDocument } from '../documents/documentRuntime'
import { PromptPartUtil, registerPromptPartUtil } from './PromptPartUtil'

const MAX_DOCUMENTS = 100
const MAX_WARNINGS = 5
const MAX_WARNING_CHARACTERS = 300
const MAX_ERROR_CHARACTERS = 300
const MAX_NAME_CHARACTERS = 200

export const DocumentsPartUtil = registerPromptPartUtil(class DocumentsPartUtil extends PromptPartUtil<DocumentsPart> {
	static override type = 'documents' as const
	override getPart(_request: AgentRequest): DocumentsPart {
		if (!getCurrentKnowledgeScope(this.editor).pluginIds.includes('document-understanding')) return { type: 'documents', documents: [] }
		const documents = this.editor.getAssets().flatMap(asset => {
			const doc = readCanvasDocument(asset.meta)
			if (!doc) return []
			const warnings = doc.extraction?.warnings ?? []
			const awaiting = documentIndexState(this.editor, asset.id) === 'awaiting-confirmation'
			return [{
				id: doc.id,
				name: clip(doc.name, MAX_NAME_CHARACTERS),
				status: awaiting ? 'not indexed (awaiting user confirmation)' : doc.status,
				...(doc.error ? { error: clip(doc.error, MAX_ERROR_CHARACTERS) } : {}),
				pages: doc.extraction?.pages ?? null,
				warnings: warnings.length > MAX_WARNINGS
					? [...warnings.slice(0, MAX_WARNINGS - 1).map(warning => clip(String(warning), MAX_WARNING_CHARACTERS)), `${warnings.length - MAX_WARNINGS + 1} more warnings omitted.`]
					: warnings.map(warning => clip(String(warning), MAX_WARNING_CHARACTERS)),
			}]
		})
		return { type: 'documents', documents: documents.slice(0, MAX_DOCUMENTS) }
	}
})

function clip(value: string, limit: number) {
	return value.length > limit ? value.slice(0, limit - 1) + '…' : value
}
