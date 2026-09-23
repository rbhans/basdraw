import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ConnectionApprovalRuntime } from '../client/connections/ConnectionApprovalRuntime.ts'

const request = { ownerAgentId: 'agent-a', turnId: '1', connectionId: 'station', connectionLabel: 'Station', toolId: 'write', toolDescription: 'Write a value.', sessionId: 'session-1', arguments: { value: 42, point: 'slot:/P' } }
const binding = ({ connectionLabel: _l, toolDescription: _d, ...rest }) => rest
const waitForCard = async (runtime) => { while (!runtime.getSnapshot().length) await new Promise(resolve => setTimeout(resolve, 0)) }

test('connection approvals are observable, owner-scoped and issue a token', async () => {
	const runtime = new ConnectionApprovalRuntime()
	let changes = 0
	const unsubscribe = runtime.subscribe(() => changes++)
	const decision = runtime.request(request)
	await waitForCard(runtime)
	const [pending] = runtime.getSnapshot()
	assert.equal(pending.ownerAgentId, 'agent-a')
	assert.equal(pending.status, 'pending')
	assert.equal('settle' in pending, false)
	assert.equal('canonicalArguments' in pending, false)
	runtime.resolve(pending.id, true)
	const result = await decision
	assert.equal(result.approved, true)
	assert.match(result.argsHash, /^[0-9a-f]{64}$/)
	assert.equal(runtime.getSnapshot().length, 0)
	assert.equal(changes, 2)
	unsubscribe()
})

test('approval tokens are single-use', async () => {
	const runtime = new ConnectionApprovalRuntime()
	const decision = runtime.request(request)
	await waitForCard(runtime)
	runtime.resolve(runtime.getSnapshot()[0].id, true)
	const { token } = await decision
	// Key order does not matter; values do.
	runtime.consume(token, binding({ ...request, arguments: { point: 'slot:/P', value: 42 } }))
	assert.throws(() => runtime.consume(token, binding(request)), /already used/)
	assert.throws(() => runtime.consume(undefined, binding(request)), /explicit user confirmation/)
})

for (const [name, change, pattern] of [
	['different arguments', { arguments: { value: 43, point: 'slot:/P' } }, /request changed/],
	['different session', { sessionId: 'session-2' }, /connection changed/],
	['different tool', { toolId: 'clear_alarm' }, /different connection tool/],
	['different connection', { connectionId: 'other' }, /different connection tool/],
	['superseded turn', { turnId: '2' }, /superseded/],
	['different agent', { ownerAgentId: 'agent-b' }, /superseded/],
]) {
	test(`approval tokens reject a binding mismatch: ${name}, and are burned by the attempt`, async () => {
		const runtime = new ConnectionApprovalRuntime()
		const decision = runtime.request(request)
		await waitForCard(runtime)
		runtime.resolve(runtime.getSnapshot()[0].id, true)
		const { token } = await decision
		assert.throws(() => runtime.consume(token, binding({ ...request, ...change })), pattern)
		assert.throws(() => runtime.consume(token, binding(request)), /already used/)
	})
}

test('pending approvals expire and can no longer be approved', async () => {
	let now = 1_000
	const runtime = new ConnectionApprovalRuntime({ now: () => now, requestTtlMs: 5 * 60_000 })
	const decision = runtime.request(request)
	await waitForCard(runtime)
	const [pending] = runtime.getSnapshot()
	assert.equal(pending.expiresAt, 1_000 + 5 * 60_000)
	now += 5 * 60_000
	runtime.resolve(pending.id, true)
	assert.deepEqual(await decision, { approved: false, reason: 'expired' })
	assert.equal(runtime.getSnapshot()[0].status, 'expired')
	runtime.resolve(pending.id, true)
	assert.equal(runtime.getSnapshot()[0].status, 'expired')
	runtime.dismiss(pending.id)
	assert.equal(runtime.getSnapshot().length, 0)
})

test('the expiry timer settles an unanswered approval', async () => {
	const runtime = new ConnectionApprovalRuntime({ requestTtlMs: 5 })
	assert.deepEqual(await runtime.request(request), { approved: false, reason: 'expired' })
	assert.equal(runtime.getSnapshot()[0].status, 'expired')
})

test('issued tokens expire', async () => {
	let now = 0
	const runtime = new ConnectionApprovalRuntime({ now: () => now, tokenTtlMs: 1_000 })
	const decision = runtime.request(request)
	await waitForCard(runtime)
	runtime.resolve(runtime.getSnapshot()[0].id, true)
	const { token } = await decision
	now = 1_000
	assert.throws(() => runtime.consume(token, binding(request)), /expired/)
})

test('cancelOwner rejects and removes only that agent\'s cards and revokes its tokens', async () => {
	const runtime = new ConnectionApprovalRuntime()
	const approved = runtime.request(request)
	await waitForCard(runtime)
	runtime.resolve(runtime.getSnapshot()[0].id, true)
	const { token } = await approved
	const first = runtime.request(request)
	const second = runtime.request({ ...request, ownerAgentId: 'agent-b' })
	while (runtime.getSnapshot().length < 2) await new Promise(resolve => setTimeout(resolve, 0))
	runtime.cancelOwner('agent-a')
	assert.deepEqual(await first, { approved: false, reason: 'cancelled' })
	assert.equal(runtime.getSnapshot().length, 1)
	assert.equal(runtime.getSnapshot()[0].ownerAgentId, 'agent-b')
	assert.throws(() => runtime.consume(token, binding(request)), /already used|cancelled/)
	runtime.resolve(runtime.getSnapshot()[0].id, true)
	assert.equal((await second).approved, true)
})

test('a card whose turn was superseded cannot be approved', async () => {
	const runtime = new ConnectionApprovalRuntime()
	let current = true
	const decision = runtime.request({ ...request, isCurrent: () => current })
	await waitForCard(runtime)
	current = false
	runtime.resolve(runtime.getSnapshot()[0].id, true)
	assert.deepEqual(await decision, { approved: false, reason: 'superseded' })
})

test('cancelling while the card is being created never shows it', async () => {
	const runtime = new ConnectionApprovalRuntime()
	let current = true
	const decision = runtime.request({ ...request, isCurrent: () => current })
	current = false
	runtime.cancelOwner('agent-a')
	assert.deepEqual(await decision, { approved: false, reason: 'superseded' })
	assert.equal(runtime.getSnapshot().length, 0)
})
