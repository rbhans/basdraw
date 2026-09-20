import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ConnectionApprovalRuntime } from '../client/connections/ConnectionApprovalRuntime.ts'

const request = { ownerAgentId: 'agent-a', connectionId: 'station', connectionLabel: 'Station', toolId: 'write', toolDescription: 'Write a value.', arguments: { value: 42 } }

test('connection approvals are one-time, observable and owner-scoped', async () => {
	const runtime = new ConnectionApprovalRuntime()
	let changes = 0
	const unsubscribe = runtime.subscribe(() => changes++)
	const decision = runtime.request(request)
	const [pending] = runtime.getSnapshot()
	assert.equal(pending.ownerAgentId, 'agent-a')
	assert.equal('resolve' in pending, false)
	runtime.resolve(pending.id, true)
	assert.equal(await decision, true)
	assert.equal(runtime.getSnapshot().length, 0)
	assert.equal(changes, 2)
	unsubscribe()
})

test('cancelling an agent rejects only its pending writes', async () => {
	const runtime = new ConnectionApprovalRuntime()
	const first = runtime.request(request)
	const second = runtime.request({ ...request, ownerAgentId: 'agent-b' })
	runtime.cancelOwner('agent-a')
	assert.equal(await first, false)
	assert.equal(runtime.getSnapshot().length, 1)
	runtime.resolve(runtime.getSnapshot()[0].id, true)
	assert.equal(await second, true)
})
