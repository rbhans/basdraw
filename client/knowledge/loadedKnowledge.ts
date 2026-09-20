import type { TldrawAgent } from '../agent/TldrawAgent'
import type { KnowledgeRequest } from '../../shared/knowledge'

type Selection = { operation: 'loadSkill' | 'getReference'; id: string; offset: number }
const sessions = new WeakMap<TldrawAgent, { scope: string; anchor: object | undefined; pages: Selection[] }>()

export function loadedKnowledge(agent: TldrawAgent, scope: string): Selection[] {
	const session = sessions.get(agent)
	if (!session || session.scope !== scope || !session.anchor || session.anchor !== agent.chat.getHistory()[0]) {
		sessions.delete(agent)
		return []
	}
	return session.pages
}

export function retainKnowledge(agent: TldrawAgent, scope: string, request: KnowledgeRequest) {
	if ((request.operation !== 'loadSkill' && request.operation !== 'getReference') || !request.id) return
	const pages = loadedKnowledge(agent, scope)
	const page: Selection = { operation: request.operation, id: request.id, offset: request.offset ?? 0 }
	sessions.set(agent, { scope, anchor: agent.chat.getHistory()[0], pages: [...pages.filter((p) => p.id !== page.id || p.offset !== page.offset), page].slice(-4) })
}
