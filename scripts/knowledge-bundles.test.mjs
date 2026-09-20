import assert from 'node:assert/strict'
import { test } from 'node:test'
import { KnowledgeService } from '../worker/knowledge/KnowledgeService.ts'
import { baskstreamKnowledge } from '../shared/knowledge/baskstream.ts'
import { behaviorKnowledge, canvasAgentKnowledge, dataWidgetKnowledge, vectorPdfKnowledge, webViewKnowledge } from '../shared/knowledge/canvasAgent.ts'
import { relationshipKnowledge } from '../shared/knowledge/relationships.ts'

const knowledgeBundles = [baskstreamKnowledge, canvasAgentKnowledge, behaviorKnowledge, dataWidgetKnowledge, vectorPdfKnowledge, webViewKnowledge, relationshipKnowledge]

const unavailableStore = {
	catalog: async () => ({ entries: [], hasMore: false }),
	getScoped: async () => null,
	search: async () => [],
}

test('enabled feature plugins contribute discoverable skills and references', async () => {
	const service = new KnowledgeService(unavailableStore, knowledgeBundles)
	const scope = { pluginIds: ['canvas-agent', 'live-behaviors', 'data-widgets', 'vector-pdf', 'web-view', 'relationship-map'], connectionTypes: [] }
	const catalog = await service.catalog(scope)
	const ids = catalog.entries.map((entry) => entry.id)
	for (const id of ['basdraw:canvas-composition', 'tldraw-agent-starter', 'basdraw-behaviors', 'basdraw-data-widgets', 'basdraw-vector-pdf', 'basdraw-web-view', 'basdraw:relationships']) {
		assert.ok(ids.includes(id), `${id} should be in the scoped catalog`)
	}
	assert.match((await service.retrieve(scope, { operation: 'loadSkill', id: 'basdraw:canvas-composition' })).content, /plugin capability IDs/)
	assert.match((await service.retrieve(scope, { operation: 'loadSkill', id: 'basdraw:relationships' })).content, /native bound tldraw arrows/)
})

test('disabled plugins do not leak their canvas instructions', async () => {
	const service = new KnowledgeService(unavailableStore, knowledgeBundles)
	await assert.rejects(service.retrieve({ pluginIds: ['canvas-agent'] }, { operation: 'loadSkill', id: 'basdraw:relationships' }), /unavailable/)
})
