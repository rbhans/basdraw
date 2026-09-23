import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ConnectionRuntime } from '../client/connections/ConnectionRuntime.ts'
import { ConnectionApprovalRuntime } from '../client/connections/ConnectionApprovalRuntime.ts'
import { ConnectionDispatchError } from '../shared/connections.ts'

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

const writeTool = (extra = {}) => ({ id: 'set', description: 'Set a value.', effect: 'write', inputSchema: {}, dispatch: async () => ({ ok: true }), ...extra })

async function approve(approvals, binding) {
	const decision = approvals.request({ ...binding, connectionLabel: 'Demo', toolDescription: 'Set' })
	while (!approvals.getSnapshot().length) await new Promise(resolve => setTimeout(resolve, 0))
	approvals.resolve(approvals.getSnapshot()[0].id, true)
	return (await decision).token
}

const binding = { ownerAgentId: 'agent', turnId: '1', connectionId: 'demo', toolId: 'set', sessionId: 'session', arguments: { value: 1 } }
const writeOptions = (token, extra = {}) => ({ access: 'write', approvalToken: token, ownerAgentId: 'agent', turnId: '1', ...extra })

test('descriptions expose tool metadata without executable functions', () => {
	const runtime = new ConnectionRuntime()
	runtime.register(adapter({ sessionId: 'session', tools: [...adapter().tools, writeTool({ risk: 'high', riskFor: () => 'high', resultNote: 'x' })] }))
	const [description] = runtime.describe('write')
	assert.equal(description.id, 'demo')
	assert.equal(description.tools[0].id, 'lookup')
	assert.equal('execute' in description.tools[0], false)
	assert.deepEqual(Object.keys(description.tools[1]).sort(), ['description', 'effect', 'id', 'inputSchema', 'risk'])
})

test('connection tools execute through their adapter', async () => {
	const runtime = new ConnectionRuntime()
	runtime.register(adapter())
	assert.deepEqual(await runtime.execute('demo', 'lookup', { query: 'supply air' }), {
		query: 'supply air', value: 42,
	})
})

test('adapters exposing write tools must have a session id', () => {
	const runtime = new ConnectionRuntime()
	assert.throws(() => runtime.register(adapter({ tools: [writeTool()] })), /without a session id/)
	assert.throws(() => runtime.register(adapter({ sessionId: '  ', tools: [writeTool()] })), /without a session id/)
	assert.doesNotThrow(() => runtime.register(adapter()))
})

test('disconnected adapters and writes fail closed without a valid approval token', async () => {
	const disconnected = new ConnectionRuntime()
	disconnected.register(adapter({ connected: false }))
	await assert.rejects(disconnected.execute('demo', 'lookup', {}), /not connected/)

	let dispatched = 0
	const approvals = new ConnectionApprovalRuntime()
	const writes = new ConnectionRuntime({ approvals })
	writes.register(adapter({ sessionId: 'session', tools: [writeTool({ dispatch: async () => { dispatched++; return { ok: true } } })] }))
	assert.equal(writes.describe('read')[0].tools.length, 0)
	assert.equal(writes.describe('write')[0].tools.length, 1)
	await assert.rejects(writes.execute('demo', 'set', { value: 1 }), /read-only/)
	await assert.rejects(writes.execute('demo', 'set', { value: 1 }, { access: 'write' }), /explicit user confirmation/)
	// The old boolean flag is ignored.
	await assert.rejects(writes.execute('demo', 'set', { value: 1 }, { access: 'write', confirmedWrite: true }), /explicit user confirmation/)
	await assert.rejects(writes.execute('demo', 'set', { value: 1 }, writeOptions('forged-token')), /already used|never issued/)
	const token = await approve(approvals, binding)
	await assert.rejects(writes.execute('demo', 'set', { value: 2 }, writeOptions(token)), /request changed/)
	assert.equal(dispatched, 0)
	const second = await approve(approvals, binding)
	assert.deepEqual(await writes.execute('demo', 'set', { value: 1 }, writeOptions(second)), { ok: true, outcome: 'succeeded', response: { ok: true }, verification: undefined, note: undefined })
	await assert.rejects(writes.execute('demo', 'set', { value: 1 }, writeOptions(second)), /already used/)
	assert.equal(dispatched, 1)
})

test('write runtime without an approval verifier never dispatches', async () => {
	const runtime = new ConnectionRuntime()
	runtime.register(adapter({ sessionId: 'session', tools: [writeTool({ dispatch: async () => { throw new Error('Should never run') } })] }))
	await assert.rejects(runtime.execute('demo', 'set', {}, { access: 'write', approvalToken: 'x' }), /explicit user confirmation/)
})

test('the runtime re-checks policy after preflight and before dispatch', async () => {
	const approvals = new ConnectionApprovalRuntime()
	const runtime = new ConnectionRuntime({ approvals })
	let allowed = true, dispatched = 0
	runtime.register(adapter({ sessionId: 'session', tools: [writeTool({ prepare: async () => { allowed = false }, dispatch: async () => { dispatched++ } })] }))
	const token = await approve(approvals, binding)
	await assert.rejects(runtime.execute('demo', 'set', { value: 1 }, writeOptions(token, { isExecutionAllowed: () => allowed })), /cancelled or access changed/)
	assert.equal(dispatched, 0)
})

test('dispatch failures map to failed, not-sent or unknown outcomes', async () => {
	const approvals = new ConnectionApprovalRuntime()
	const cases = [
		[new ConnectionDispatchError('socket closed', 'not-sent'), 'throws'],
		[new ConnectionDispatchError('station refused', 'rejected'), 'failed'],
		[new ConnectionDispatchError('write timed out', 'unknown'), 'unknown'],
		[new Error('untagged transport error'), 'unknown'],
	]
	for (const [error, expected] of cases) {
		const runtime = new ConnectionRuntime({ approvals })
		runtime.register(adapter({ sessionId: 'session', tools: [writeTool({ dispatch: async () => { throw error } })] }))
		const token = await approve(approvals, binding)
		const run = runtime.execute('demo', 'set', { value: 1 }, writeOptions(token))
		if (expected === 'throws') { await assert.rejects(run, /socket closed/); continue }
		const result = await run
		assert.equal(result.ok, false)
		assert.equal(result.outcome, expected)
		if (expected === 'unknown') assert.equal(result.note, 'The station may have applied this write. Do not retry; read the point back first.')
	}
})

test('registration cleanup cannot remove a newer adapter instance', () => {
	const runtime = new ConnectionRuntime()
	const unregisterFirst = runtime.register(adapter({ label: 'First' }))
	runtime.register(adapter({ label: 'Second' }))
	unregisterFirst()
	assert.equal(runtime.describe()[0].label, 'Second')
})
