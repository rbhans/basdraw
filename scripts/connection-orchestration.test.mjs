import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ConnectionRuntime } from '../client/connections/ConnectionRuntime.ts'
import { ConnectionApprovalRuntime } from '../client/connections/ConnectionApprovalRuntime.ts'
import { runConnectionToolCall, auditFailureMessage, MAX_ERROR_CHARACTERS } from '../client/connections/runConnectionToolCall.ts'
import { ConnectionDispatchError } from '../shared/connections.ts'

function setup({ dispatch, auditStatus = 201, finishOk = true, prepare } = {}) {
	const events = []
	const approvals = new ConnectionApprovalRuntime()
	const runtime = new ConnectionRuntime({ approvals })
	runtime.register({
		id: 'station', type: 'demo', label: 'Station', connected: true, capabilities: [], sessionId: 'session-1',
		auditIdentity: { stationAlias: 'plant', stationEndpoint: 'https://station.local' },
		approvalCopy: { title: 'Allow station change?', previewLabel: 'Current station state' },
		tools: [
			{ id: 'set', description: 'Set', effect: 'write', inputSchema: {},
				prepare: prepare ?? (async () => { events.push('prepare'); return { current: 1 } }),
				dispatch: dispatch ?? (async () => { events.push('dispatch'); return { ok: true } }) },
			{ id: 'lookup', description: 'Lookup', effect: 'read', inputSchema: {}, execute: async () => { events.push('read'); return { value: 'x'.repeat(10) } } },
		],
	})
	const audit = {
		created: [], finished: [],
		async create(record) { events.push('audit'); this.created.push(record); return { ok: auditStatus >= 200 && auditStatus < 300, status: auditStatus } },
		async finish(id, update) { events.push(`finish:${update.state}`); this.finished.push({ id, ...update }); return finishOk },
	}
	let generation = 0
	const context = {
		runtime, approvals, audit, ownerAgentId: 'agent', turnId: '0', projectId: 'project',
		getAccess: () => 'write', isCurrent: () => generation === 0, createId: () => 'audit-1',
	}
	// Auto-approve (or act on) the card as soon as it appears.
	const onCard = (action) => { const unsubscribe = approvals.subscribe(() => {
		const [card] = approvals.getSnapshot()
		if (!card || card.status !== 'pending') return
		unsubscribe(); events.push('approval'); action(card)
	}) }
	return { events, approvals, runtime, audit, context, onCard, cancel: () => { generation++; approvals.cancelOwner('agent') } }
}

const call = { connectionId: 'station', toolId: 'set', arguments: { value: 1 } }

test('writes run in order: preflight, approval, audit, execute, audit completion', async () => {
	const { events, audit, context, approvals, onCard } = setup()
	let card
	onCard((pending) => { card = pending; approvals.resolve(pending.id, true) })
	const result = await runConnectionToolCall(call, context)
	assert.deepEqual(events, ['prepare', 'approval', 'audit', 'prepare', 'dispatch', 'finish:succeeded'])
	assert.equal(result.ok, true)
	assert.equal(result.outcome, 'succeeded')
	assert.equal(card.title, 'Allow station change?')
	assert.deepEqual(card.preview, { current: 1 })
	assert.equal(audit.created[0].sessionId, 'session-1')
	assert.equal(audit.created[0].stationAlias, 'plant')
	assert.equal(audit.created[0].stationEndpoint, 'https://station.local')
	assert.match(audit.created[0].argumentsHash, /^[0-9a-f]{64}$/)
	assert.equal('password' in audit.created[0], false)
})

test('if the audit row cannot be saved the write is not sent and the message matches the status', async () => {
	for (const [status, pattern] of [[403, /only available from the local basdraw app/], [400, /invalid/], [500, /migrations/], [0, /could not be reached/]]) {
		const { events, context, approvals, onCard } = setup({ auditStatus: status })
		onCard((pending) => approvals.resolve(pending.id, true))
		const result = await runConnectionToolCall(call, context)
		assert.equal(result.ok, false)
		assert.match(result.error, pattern)
		assert.match(result.error, /no station change was sent/)
		assert.equal(events.includes('dispatch'), false)
	}
	assert.doesNotMatch(auditFailureMessage(403), /migrations/)
})

test('an unknown outcome after dispatch is recorded as unknown and tells the model not to retry', async () => {
	const { context, approvals, onCard, audit } = setup({ dispatch: async () => { throw new ConnectionDispatchError('write timed out after it was sent.', 'unknown') } })
	onCard((pending) => approvals.resolve(pending.id, true))
	const result = await runConnectionToolCall(call, context)
	assert.equal(result.ok, false)
	assert.equal(result.outcome, 'unknown')
	assert.equal(result.note, 'The station may have applied this write. Do not retry; read the point back first.')
	assert.equal(audit.finished[0].state, 'unknown')
})

test('a write that was not sent is recorded as failed', async () => {
	const { context, approvals, onCard, audit } = setup({ dispatch: async () => { throw new ConnectionDispatchError('not connected', 'not-sent') } })
	onCard((pending) => approvals.resolve(pending.id, true))
	const result = await runConnectionToolCall(call, context)
	assert.equal(result.outcome, 'not-sent')
	assert.equal(audit.finished[0].state, 'failed')
})

test('cancelling the turn while the card is open rejects it, nothing is audited or sent', async () => {
	const { events, context, onCard, cancel, approvals } = setup()
	onCard(() => cancel())
	const result = await runConnectionToolCall(call, context)
	assert.equal(result.ok, false)
	assert.match(result.error, /cancelled/)
	assert.deepEqual(events, ['prepare', 'approval'])
	assert.equal(approvals.getSnapshot().length, 0)
})

test('cancelling after the audit row exists marks it cancelled and sends nothing', async () => {
	const { events, context, approvals, onCard, audit } = setup()
	const create = audit.create.bind(audit)
	let generation = 0
	context.isCurrent = () => generation === 0
	audit.create = async (record) => { const saved = await create(record); generation++; approvals.cancelOwner('agent'); return saved }
	onCard((pending) => approvals.resolve(pending.id, true))
	const result = await runConnectionToolCall(call, context)
	assert.equal(result.ok, false)
	assert.equal(audit.finished[0].state, 'cancelled')
	assert.equal(events.includes('dispatch'), false)
})

test('denied and expired approvals return without auditing', async () => {
	const { events, context, approvals, onCard } = setup()
	onCard((pending) => approvals.resolve(pending.id, false))
	assert.match((await runConnectionToolCall(call, context)).error, /not approved/)
	assert.equal(events.includes('audit'), false)
})

test('error text returned to the model is capped', async () => {
	const { context } = setup({ prepare: async () => { throw new Error('x'.repeat(5_000)) } })
	const result = await runConnectionToolCall(call, context)
	assert.ok(result.error.length < MAX_ERROR_CHARACTERS + 100)
	assert.match(result.error, /truncated/)
})

test('read tools skip approval and audit', async () => {
	const { events, context } = setup()
	const result = await runConnectionToolCall({ connectionId: 'station', toolId: 'lookup', arguments: {} }, { ...context, getAccess: () => 'read' })
	assert.equal(result.ok, true)
	assert.deepEqual(events, ['read'])
})
