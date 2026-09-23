import assert from 'node:assert/strict'
import test from 'node:test'
import { createBaskstreamWriteTools } from '../client/connections/baskstreamWriteTools.ts'
import { validateBaskstreamInput, resultHasFailure } from '../shared/baskstreamProtocol.ts'
import { ConnectionRuntime, getToolRisk } from '../client/connections/ConnectionRuntime.ts'
import { ConnectionApprovalRuntime } from '../client/connections/ConnectionApprovalRuntime.ts'
import { ConnectionDispatchError } from '../shared/connections.ts'

/** Registers tools on a runtime and runs one approved write the same way the agent does. */
async function runApproved(tools, toolId, args, { sessionId = 'session', isExecutionAllowed } = {}) {
 const approvals = new ConnectionApprovalRuntime()
 const runtime = new ConnectionRuntime({ approvals })
 runtime.register({ id: 'station', sessionId, type: 'baskstream', label: 'Station', connected: true, capabilities: [], tools })
 const decision = approvals.request({ ownerAgentId: 'agent', turnId: '1', connectionId: 'station', connectionLabel: 'Station', toolId, toolDescription: '', sessionId, arguments: args })
 while (!approvals.getSnapshot().length) await new Promise(resolve => setTimeout(resolve, 0))
 approvals.resolve(approvals.getSnapshot()[0].id, true)
 const { token } = await decision
 return runtime.execute('station', toolId, args, { access: 'write', approvalToken: token, ownerAgentId: 'agent', turnId: '1', isExecutionAllowed })
}

test('write contracts reject envelope injection, ambiguous values and invalid relation targets', () => {
 assert.throws(() => validateBaskstreamInput('write', { point: 'slot:/P', action: 'set', value: true, op: 'other' }))
 assert.throws(() => validateBaskstreamInput('write', { point: 'slot:/P', action: 'override' }))
 assert.throws(() => validateBaskstreamInput('write', { point: 'slot:/P', action: 'auto', value: true }))
 assert.throws(() => validateBaskstreamInput('write_relations', { targets: [{ ord: 'slot:/P', add: [{ id: 'hs:equipRef', endpoint: 'hierarchy:foo' }] }] }))
 assert.deepEqual(validateBaskstreamInput('write_tags', { targets: [{ ord: 'slot:/P', set: [{ id: 'hs:equip' }] }] }).targets[0].set[0], { id: 'hs:equip' })
})

test('write discovery fails closed without advertised operations and preflight', () => {
 assert.equal(createBaskstreamWriteTools([], async () => ({})).length, 0)
 assert.equal(createBaskstreamWriteTools(['write'], async () => ({})).length, 0)
})

test('point writes preflight, send the exact command once, and read back without automatic retries', async () => {
 const calls = []
 const request = async (op, fields) => { calls.push({ op, fields }); return op === 'describe_write' ? { points: [{ point: 'slot:/P', writable: true, valueKind: 'boolean', actions: ['override'], supportsDuration: true }] } : { points: [{ value: false, activeLevel: '1' }] } }
 const tools = createBaskstreamWriteTools(['write', 'describe_write'], request)
 const result = await runApproved(tools, 'write', { point: 'slot:/P', action: 'override', value: true, durationSec: 300 })
 assert.deepEqual(calls.map(c => c.op), ['describe_write', 'write', 'read'])
 assert.equal(calls[1].fields.confirmedWrite, true)
 assert.equal(result.outcome, 'succeeded')
 assert.equal(result.verification.points[0].activeLevel, '1')
 calls.length = 0
 await assert.rejects(runApproved(tools, 'write', { point: 'slot:/P', action: 'set', value: true }), /does not permit/)
 assert.deepEqual(calls.map(c => c.op), ['describe_write'])
})

test('tag writes retain partial failures and read back tags/relations', async () => {
 const calls = []
 const tools = createBaskstreamWriteTools(['read_tags', 'write_tags'], async op => { calls.push(op); return op === 'write_tags' ? { targets: [{ ok: true, results: [{ ok: false, code: 'implied_tag' }] }] } : { targets: [{ ord: 'slot:/VAV1', ok: true, tags: [] }] } })
 const result = await runApproved(tools, 'write_tags', { targets: [{ ord: 'slot:/VAV1', remove: ['hs:equip'] }] })
 assert.equal(result.ok, false)
 assert.equal(result.outcome, 'failed')
 assert.equal(resultHasFailure(result.response), true)
 assert.deepEqual(calls, ['read_tags', 'write_tags', 'read_tags'])
})

test('cancellation during awaited preflight prevents the actual station mutation', async () => {
 const calls = []; let allowed = true
 const tools = createBaskstreamWriteTools(['write', 'describe_write'], async op => {
  calls.push(op); await Promise.resolve(); allowed = false
  return { points: [{ point: 'slot:/P', writable: true, valueKind: 'boolean', actions: ['set'] }] }
 })
 await assert.rejects(runApproved(tools, 'write', { point: 'slot:/P', action: 'set', value: true }, { isExecutionAllowed: () => allowed }), /cancelled or access changed/)
 assert.deepEqual(calls, ['describe_write'])
})

test('approval from one station session cannot execute on a replacement connection', async () => {
 const approvals = new ConnectionApprovalRuntime()
 const runtime = new ConnectionRuntime({ approvals })
 const decision = approvals.request({ ownerAgentId: 'agent', turnId: '1', connectionId: 'station', connectionLabel: 'Station', toolId: 'write', toolDescription: '', sessionId: 'old', arguments: {} })
 while (!approvals.getSnapshot().length) await new Promise(resolve => setTimeout(resolve, 0))
 approvals.resolve(approvals.getSnapshot()[0].id, true)
 const { token } = await decision
 runtime.register({ id: 'station', sessionId: 'new', type: 'baskstream', label: 'Station', connected: true, capabilities: [], tools: [{ id: 'write', description: 'Write', effect: 'write', inputSchema: {}, dispatch: () => { throw new Error('Should never run') } }] })
 await assert.rejects(runtime.execute('station', 'write', {}, { access: 'write', approvalToken: token, ownerAgentId: 'agent', turnId: '1' }), /connection changed/)
})

test('a timeout after the write was sent is reported as unknown, never retried or read as failed', async () => {
 const calls = []
 const tools = createBaskstreamWriteTools(['ack_alarm'], async (op) => { calls.push(op); throw new ConnectionDispatchError('ack_alarm timed out after it was sent.', 'unknown') })
 const result = await runApproved(tools, 'ack_alarm', { uuid: '0b0f6a2c-5c1e-4d8a-9d2e-2f3a4b5c6d7e' })
 assert.deepEqual(result, { ok: false, outcome: 'unknown', error: 'ack_alarm timed out after it was sent.', note: 'The station may have applied this write. Do not retry; read the point back first.' })
 assert.deepEqual(calls, ['ack_alarm'])
})

test('a write that was never sent fails as not sent', async () => {
 const tools = createBaskstreamWriteTools(['ack_alarm'], async () => { throw new ConnectionDispatchError('baskStream is not connected.', 'not-sent') })
 await assert.rejects(runApproved(tools, 'ack_alarm', { uuid: '0b0f6a2c-5c1e-4d8a-9d2e-2f3a4b5c6d7e' }), /not connected/)
})

test('alarm operations have no preflight state and force-clear/emergency writes are high risk', async () => {
 const tools = createBaskstreamWriteTools(['write', 'describe_write', 'ack_alarm', 'clear_alarm', 'clear_alarms'], async () => ({}))
 const byId = Object.fromEntries(tools.map(tool => [tool.id, tool]))
 assert.equal(await byId.ack_alarm.prepare({ uuid: '0b0f6a2c-5c1e-4d8a-9d2e-2f3a4b5c6d7e' }), undefined)
 assert.equal(getToolRisk(byId.ack_alarm, {}), 'normal')
 assert.equal(getToolRisk(byId.clear_alarm, {}), 'high')
 assert.equal(byId.clear_alarms.risk, 'high')
 assert.equal(getToolRisk(byId.write, { point: 'slot:/P', action: 'emergency_override', value: true }), 'high')
 assert.equal(getToolRisk(byId.write, { point: 'slot:/P', action: 'override', value: true }), 'normal')
})

test('BaskstreamClient distinguishes not-sent, rejected and sent-but-unanswered requests', async () => {
 globalThis.window ??= globalThis
 const sent = []
 globalThis.WebSocket ??= class { static OPEN = 1; static CLOSING = 2 }
 const { BaskstreamClient } = await import('../client/bas/BaskstreamClient.ts')
 const client = new BaskstreamClient()
 await assert.rejects(client.request('write', {}), error => error.dispatch === 'not-sent')
 client.socket = { readyState: 1, send: (payload) => sent.push(JSON.parse(payload)), close() {} }
 await assert.rejects(client.request('write', { point: 'slot:/P' }, 5), error => error.dispatch === 'unknown' && /timed out/.test(error.message))
 assert.equal(sent.length, 1)
 const closed = client.request('write', {}, 1_000)
 client.onClosed()
 await assert.rejects(closed, error => error.dispatch === 'unknown')
 client.socket = { readyState: 1, send: (payload) => sent.push(JSON.parse(payload)), close() {} }
 const refused = client.request('write', {}, 1_000)
 client.onMessage(JSON.stringify({ id: sent.at(-1).id, op: 'error', message: 'Denied' }))
 await assert.rejects(refused, error => error.dispatch === 'rejected')
 client.socket = { readyState: 1, send: () => { throw new Error('InvalidStateError') }, close() {} }
 await assert.rejects(client.request('write', {}, 1_000), error => error.dispatch === 'not-sent')
})
