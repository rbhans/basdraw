import type { KnowledgeScopePart } from '../../shared/schema/PromptPartDefinitions'
import type { AgentRequest } from '../../shared/types/AgentRequest'
import { getCurrentKnowledgeScope } from '../knowledge/currentKnowledgeScope'
import { loadedKnowledge } from '../knowledge/loadedKnowledge'
import { PromptPartUtil, registerPromptPartUtil } from './PromptPartUtil'

export const KnowledgeScopePartUtil = registerPromptPartUtil(
	class KnowledgeScopePartUtil extends PromptPartUtil<KnowledgeScopePart> {
		static override type = 'knowledgeScope' as const

		override getPart(_request: AgentRequest): KnowledgeScopePart {
			const scope = getCurrentKnowledgeScope(this.editor)
			return { type: 'knowledgeScope', ...scope, loaded: loadedKnowledge(this.agent, JSON.stringify(scope)) }
		}
	}
)
