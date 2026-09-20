import type { JsonValue } from 'tldraw'
import { KnowledgeAction } from '../../shared/schema/AgentActionSchemas'
import type { Streaming } from '../../shared/types/Streaming'
import { getCurrentKnowledgeScope } from '../knowledge/currentKnowledgeScope'
import { retainKnowledge } from '../knowledge/loadedKnowledge'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'

export const KnowledgeActionUtil = registerActionUtil(
	class KnowledgeActionUtil extends AgentActionUtil<KnowledgeAction> {
		static override type = 'knowledge' as const
		override getInfo(action: Streaming<KnowledgeAction>) {
			return { icon: 'search' as const, description: action.operation === 'search' ? 'Search project knowledge' : `Read ${action.id || 'knowledge catalog'}` }
		}
		override async applyAction(action: Streaming<KnowledgeAction>) {
			if (!action.complete) return
			const scope = getCurrentKnowledgeScope(this.editor)
			const activeRequest = this.agent.requests.getActiveRequest()
			let result: JsonValue
			try {
				const parsed = KnowledgeAction.parse(action)
				const response = await fetch('/api/knowledge/retrieve', {
					method: 'POST', headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ scope, request: parsed }),
					signal: AbortSignal.timeout(15_000),
				})
				const data = await response.json() as JsonValue
				if (!response.ok) throw new Error(data && typeof data === 'object' && 'error' in data ? String(data.error) : 'Knowledge retrieval failed.')
				if (activeRequest !== this.agent.requests.getActiveRequest()) return
				if (JSON.stringify(scope) !== JSON.stringify(getCurrentKnowledgeScope(this.editor))) return
				retainKnowledge(this.agent, JSON.stringify(scope), parsed)
				result = { kind: 'knowledge-result', operation: parsed.operation, id: parsed.id ?? null, ok: true, data }
			} catch (cause) {
				result = { kind: 'knowledge-result', ok: false, error: cause instanceof Error ? cause.message : String(cause) }
			}
			// A late response must never be attached to a different project.
			if (JSON.stringify(scope) !== JSON.stringify(getCurrentKnowledgeScope(this.editor))) return
			if (!this.agent.requests.isGenerating()) return
			if (activeRequest !== this.agent.requests.getActiveRequest()) return
			this.agent.schedule({ data: [result] })
		}
	}
)
