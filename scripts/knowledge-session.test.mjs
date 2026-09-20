import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadedKnowledge, retainKnowledge } from '../client/knowledge/loadedKnowledge.ts'

test('loaded pages persist across follow-ups but not new chats or project changes', () => {
	let history = [{ type: 'prompt', text: 'Original request' }]
	const agent = { chat: { getHistory: () => history } }
	retainKnowledge(agent, 'project-a', { operation: 'loadSkill', id: 'workflow' })
	history = [...history, { type: 'prompt', text: 'Follow-up' }]
	assert.equal(loadedKnowledge(agent, 'project-a')[0].id, 'workflow')
	// A new request may already have entered history before the first prompt part builds.
	history = [{ type: 'prompt', text: 'New chat' }]
	assert.equal(loadedKnowledge(agent, 'project-a').length, 0)
	retainKnowledge(agent, 'project-a', { operation: 'getReference', id: 'notes' })
	assert.equal(loadedKnowledge(agent, 'project-b').length, 0)
})

test('retained context is bounded, deduplicated and does not retain search results', () => {
	const history = [{}]
	const agent = { chat: { getHistory: () => history } }
	for (let i = 0; i < 6; i++) retainKnowledge(agent, 'scope', { operation: 'getReference', id: `ref-${i}` })
	retainKnowledge(agent, 'scope', { operation: 'getReference', id: 'ref-5' })
	retainKnowledge(agent, 'scope', { operation: 'search', query: 'search' })
	assert.deepEqual(loadedKnowledge(agent, 'scope').map((page) => page.id), ['ref-2', 'ref-3', 'ref-4', 'ref-5'])
})
