import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { KnowledgeStore } from '../worker/knowledge/KnowledgeStore.ts'
import { KnowledgeService, formatKnowledgeCatalog } from '../worker/knowledge/KnowledgeService.ts'
import { baskstreamKnowledge } from '../shared/knowledge/baskstream.ts'

const scope = { projectId: 'project-a', connectionIds: ['station-a', 'second-connection'], connectionTypes: ['baskstream'], pluginIds: ['niagara-baskstream'] }
function setup(t) {
	const db = new DatabaseSync(':memory:')
	db.exec(readFileSync(new URL('../migrations/0001_knowledge_store.sql', import.meta.url), 'utf8'))
	t.after(() => db.close())
	const d1 = { prepare(sql) {
		const statement = db.prepare(sql)
		const bound = (args = []) => ({
			bind: (...values) => bound(values),
			all: async () => ({ results: statement.all(...args) }),
			first: async () => statement.get(...args) ?? null,
			run: async () => ({ meta: statement.run(...args) }),
		})
		return bound()
	} }
	const store = new KnowledgeStore(d1)
	const service = new KnowledgeService(store, [baskstreamKnowledge])
	const add = (id, fields = {}) => store.create({ id, kind: 'reference', title: id, description: 'Design reference', content: 'AHU supply sequence. Evidence token: 1234.', scopeType: 'project', scopeId: 'project-a', enabled: true, priority: 0, source: 'test', tags: [], ...fields })
	return { db, store, service, add }
}

test('catalog excludes bodies, includes plugin version and does not require a database seed', async (t) => {
	const { service, add } = setup(t)
	await add('project-note')
	const catalog = await service.catalog(scope)
	assert.equal(catalog.entries.length, 3)
	assert.equal(catalog.entries[0].version, '1.1.0')
	assert.equal(formatKnowledgeCatalog(catalog).includes('1234'), false)
	assert.equal(JSON.stringify(catalog).includes('"content"'), false)
	assert.match((await service.retrieve(scope, { operation: 'loadSkill', id: 'basdraw:baskstream-connection' })).content, /Discover incrementally/)
})

test('scope is enforced for direct reads and search, including multiple different connections', async (t) => {
	const { service, add } = setup(t)
	await add('allowed')
	await add('other-project', { scopeId: 'project-b' })
	await add('disabled', { enabled: false })
	await add('disabled-plugin', { pluginId: 'other-plugin' })
	await add('connection-a', { scopeType: 'connection', scopeId: 'station-a' })
	await add('connection-b', { scopeType: 'connection', scopeId: 'second-connection' })
	await add('connection-c', { scopeType: 'connection', scopeId: 'unrelated' })
	for (const id of ['other-project', 'disabled', 'disabled-plugin', 'connection-c']) {
		await assert.rejects(service.retrieve(scope, { operation: 'getReference', id }), /unavailable/)
	}
	const results = await service.retrieve(scope, { operation: 'search', query: 'AHU supply' })
	assert.deepEqual(results.matches.map((entry) => entry.id).sort(), ['allowed', 'connection-a', 'connection-b'])
	const projectResults = await service.retrieve(scope, { operation: 'search', query: 'AHU', projectOnly: true })
	assert.deepEqual(projectResults.matches.map((entry) => entry.id), ['allowed'])
	assert.equal((await service.retrieve({ ...scope, projectId: null }, { operation: 'search', query: 'AHU', projectOnly: true })).matches.length, 0)
})

test('legacy seeded skill does not override or resurrect a disabled bundled plugin', async (t) => {
	const { db, service } = setup(t)
	db.exec(readFileSync(new URL('../migrations/0002_builtin_knowledge.sql', import.meta.url), 'utf8'))
	assert.equal((await service.catalog(scope)).entries.length, 2)
	for (const changedScope of [{ ...scope, pluginIds: [] }, { ...scope, connectionTypes: ['different-protocol'] }]) {
		assert.equal((await service.catalog(changedScope)).entries.length, 0)
		await assert.rejects(service.retrieve(changedScope, { operation: 'loadSkill', id: 'basdraw:baskstream-connection' }), /unavailable/)
	}
})

test('large references are readable to the end and edits or disabling take effect immediately', async (t) => {
	const { service, store, add } = setup(t)
	const content = 'x'.repeat(33000) + ' FINAL EVIDENCE'
	await add('long-reference', { content })
	let offset = 0, reconstructed = ''
	do {
		const page = await service.retrieve(scope, { operation: 'getReference', id: 'long-reference', offset })
		assert.ok(page.content.length <= 12000)
		reconstructed += page.content; offset = page.nextOffset
	} while (offset !== null)
	assert.equal(reconstructed, content)
	await store.update('long-reference', { content: 'Revised evidence' })
	assert.equal((await service.retrieve(scope, { operation: 'getReference', id: 'long-reference' })).content, 'Revised evidence')
	await store.update('long-reference', { enabled: false })
	await assert.rejects(service.retrieve(scope, { operation: 'getReference', id: 'long-reference' }), /unavailable/)
})

test('catalog pagination has no omissions or duplicates as knowledge grows', async (t) => {
	const { service, add } = setup(t)
	for (let i = 0; i < 110; i++) await add(`entry-${String(i).padStart(3, '0')}`, { description: 'd'.repeat(600) })
	let offset = 0
	const ids = []
	do {
		const page = await service.catalog(scope, offset)
		ids.push(...page.entries.map((entry) => entry.id))
		if (page.nextOffset !== null) assert.ok(page.nextOffset > offset)
		offset = page.nextOffset
	} while (offset !== null)
	assert.equal(ids.length, 112)
	assert.equal(new Set(ids).size, 112)
})

test('bundled catalogs also paginate and database outages are explicit', async () => {
	const store = { catalog: async () => { throw new Error('offline') }, getScoped: async () => null, search: async () => { throw new Error('offline') } }
	const bundle = { pluginId: 'future', version: '1.0.0', entries: Array.from({ length: 85 }, (_, i) => ({ id: `future:${i}`, kind: 'skill', title: `Workflow ${i}`, description: 'd'.repeat(500), content: 'secret body' })) }
	const service = new KnowledgeService(store, [bundle])
	let offset = 0
	const ids = []
	do {
		const page = await service.catalog({ pluginIds: ['future'] }, offset)
		assert.match(page.warning, /unavailable/)
		assert.ok(JSON.stringify(page.entries).length < 12500)
		ids.push(...page.entries.map((entry) => entry.id)); offset = page.nextOffset
	} while (offset !== null)
	assert.equal(new Set(ids).size, 85)
	assert.equal((await service.retrieve({ pluginIds: ['future'] }, { operation: 'loadSkill', id: 'future:0' })).content, 'secret body')
})
