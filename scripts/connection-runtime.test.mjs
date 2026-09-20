import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ConnectionRuntime } from '../client/connections/ConnectionRuntime.ts'

const adapter = (extra = {}) => ({
	id: 'demo',
	type: 'demo-protocol',
	label: 'Demo connection',
	connected: true,
	capabilities: ['lookup'],
	tools: [{
		id: 'lookup',
		description: 'Look up a value.',
		capability: 'lookup',
		effect: 'read',
		inputSchema: { query: 'string' },
		execute: async ({ query }) => ({ query, value: 42 }),
	}],
	...extra,
})

test('descriptions expose tool metadata without executable functions', () => {
	const runtime = new ConnectionRuntime()
	runtime.register(adapter())
	const [description] = runtime.describe()
	assert.equal(description.id, 'demo')
	assert.equal(description.tools[0].id, 'lookup')
	assert.equal('execute' in description.tools[0], false)
})

test('connection tools execute through their adapter', async () => {
	const runtime = new ConnectionRuntime()
	runtime.register(adapter())
	assert.deepEqual(await runtime.execute('demo', 'lookup', { query: 'supply air' }), {
		query: 'supply air', value: 42,
	})
})

test('disconnected adapters and writes fail closed', async () => {
	const disconnected = new ConnectionRuntime()
	disconnected.register(adapter({ connected: false }))
	await assert.rejects(disconnected.execute('demo', 'lookup', {}), /not connected/)

	const writes = new ConnectionRuntime()
	writes.register(adapter({ tools: [{
		id: 'set', description: 'Set a value.', effect: 'write', inputSchema: {}, execute: async () => true,
	}] }))
	assert.equal(writes.describe('read')[0].tools.length, 0)
	assert.equal(writes.describe('write')[0].tools.length, 1)
	await assert.rejects(writes.execute('demo', 'set', {}), /read-only/)
	await assert.rejects(writes.execute('demo', 'set', {}, { access: 'write' }), /explicit user confirmation/)
	assert.equal(await writes.execute('demo', 'set', {}, { access: 'write', confirmedWrite: true }), true)
})

test('registration cleanup cannot remove a newer adapter instance', () => {
	const runtime = new ConnectionRuntime()
	const unregisterFirst = runtime.register(adapter({ label: 'First' }))
	runtime.register(adapter({ label: 'Second' }))
	unregisterFirst()
	assert.equal(runtime.describe()[0].label, 'Second')
})
