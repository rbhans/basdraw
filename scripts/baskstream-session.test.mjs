import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BaskstreamSession } from '../client/bas/baskstreamSession.ts'

const input = { alias: 'plant', name: 'Plant', stationUrl: 'https://station', username: 'ops', password: 'secret', tlsMode: 'strict', remember: false }
const flush = () => new Promise((resolve) => setImmediate(resolve))

/** Scriptable stand-in for BaskstreamClient: records requests and lets a test fail or answer each op. */
class FakeClient {
	constructor(options = {}) {
		this.options = options
		this.requests = []
		this.listeners = new Set()
		this.closed = false
	}
	async connect() {
		if (this.options.connectError) throw this.options.connectError
		return { health: { ok: true } }
	}
	request(op, fields = {}) {
		this.requests.push({ op, ...fields })
		const handler = this.options.handlers?.[op]
		if (handler) return handler(fields, this)
		if (op === 'capabilities') return Promise.resolve({ capabilities: this.options.capabilities ?? { operations: ['subscribe'] } })
		return Promise.resolve({ points: (fields.points ?? []).map((point) => ({ point, value: 1 })) })
	}
	onPush(listener) { this.listeners.add(listener) }
	push(message) { for (const listener of this.listeners) listener(message) }
	close() { this.closed = true }
	ops(op) { return this.requests.filter((request) => request.op === op) }
}

function fakeTimers() {
	const timers = new Map()
	let next = 0
	const add = (callback, ms, repeat) => { const id = ++next; timers.set(id, { callback, ms, repeat }); return id }
	return {
		timers,
		setTimeout: (callback, ms) => add(callback, ms, false),
		clearTimeout: (id) => timers.delete(id),
		setInterval: (callback, ms) => add(callback, ms, true),
		clearInterval: (id) => timers.delete(id),
		/** Run every pending timer once (intervals stay scheduled). */
		runAll() {
			for (const [id, timer] of [...timers]) {
				if (!timer.repeat) timers.delete(id)
				timer.callback()
			}
		},
	}
}

function setup(options = {}) {
	const clients = []
	const timers = fakeTimers()
	const session = new BaskstreamSession(() => {
		const client = new FakeClient(typeof options === 'function' ? options(clients.length) : options)
		clients.push(client)
		return client
	}, timers, () => `session-${clients.length}`)
	return { session, clients, timers }
}

test('direct subscriptions record only confirmed points and retry failures', async () => {
	let fail = true
	const { session, clients, timers } = setup({ handlers: {
		subscribe: (fields) => fail ? Promise.reject(new Error('station busy')) : Promise.resolve({ points: fields.points.map((point) => ({ point, value: 5 })) }),
	} })
	await session.connect(input)
	session.setActivePoints(['b', 'a', 'a'])
	await flush()
	assert.deepEqual(session.subscribedPoints, [], 'a failed subscribe is not recorded as subscribed')
	assert.equal(session.getState().subscriptionHealth, 'stale')
	assert.match(session.getState().subscriptionError, /station busy/)
	assert.equal(timers.timers.size, 1, 'a retry is scheduled')
	fail = false
	timers.runAll()
	await flush()
	assert.deepEqual(session.subscribedPoints, ['a', 'b'])
	assert.equal(session.getState().subscriptionHealth, 'live')
	assert.equal(session.snapshots.get('a').value, 5)
	session.setActivePoints(['a'])
	await flush()
	assert.deepEqual(clients[0].ops('unsubscribe').at(-1).points, ['b'])
	assert.deepEqual(session.subscribedPoints, ['a'])
})

test('view groups: one support check drives replace, renew and release; renewal failure re-sends replace', async () => {
	const capabilities = { operations: ['replace_subscriptions'], subscriptions: { viewGroups: true }, limits: { subscriptionLeaseSec: 100 } }
	let renewFails = false
	const { session, clients, timers } = setup({ capabilities, handlers: {
		renew_subscriptions: () => renewFails ? Promise.reject(new Error('lease expired')) : Promise.resolve({}),
	} })
	session.setActivePoints(['p1'])
	await session.connect(input)
	await flush()
	const client = clients[0]
	assert.deepEqual(client.ops('replace_subscriptions').map((request) => request.points), [['p1']])
	assert.equal(client.ops('subscribe').length, 0)
	const [renewal] = [...timers.timers.values()]
	assert.equal(renewal.repeat, true)
	assert.equal(renewal.ms, 70_000)
	renewFails = true
	renewal.callback()
	await flush()
	assert.equal(client.ops('replace_subscriptions').length, 2, 'a failed renewal recreates the group')
	assert.equal(session.getState().subscriptionHealth, 'live', 'the successful replace clears the stale state')
	session.disconnect()
	assert.equal(client.ops('release_subscriptions').length, 1)
	assert.equal(client.closed, true)
	assert.equal(timers.timers.size, 0, 'timers are released')
})

test('groups without replace_subscriptions fall back to direct subscribe and never renew', async () => {
	const { session, clients, timers } = setup({ capabilities: { operations: ['subscribe'], subscriptions: { viewGroups: true, leasedGroups: true } } })
	await session.connect(input)
	session.setActivePoints(['x'])
	await flush()
	assert.equal(clients[0].ops('subscribe').length, 1)
	assert.equal(timers.timers.size, 0)
	session.disconnect()
	assert.equal(clients[0].ops('release_subscriptions').length, 0)
})

test('station close, session revoke and unsolicited errors surface a clear state', async () => {
	const { session, clients } = setup()
	await session.connect(input)
	session.setActivePoints(['a'])
	await flush()
	clients[0].push({ op: 'error', message: 'Bridge restarting' })
	assert.equal(session.getState().error, 'Bridge restarting')
	assert.equal(session.getState().status, 'connected', 'an unsolicited error does not end the session')
	clients[0].push({ op: 'station_closed' })
	const state = session.getState()
	assert.equal(state.status, 'error')
	assert.match(state.error, /closed/)
	assert.equal(state.health, null)
	assert.equal(state.connectedProfile, null)
	assert.equal(state.lastProfile.alias, 'plant', 'reconnect can prefill from the last profile')
	assert.equal(session.snapshots.get('a'), undefined, 'live values are released')
	assert.equal('password' in state.lastProfile, false)

	await session.connect(input)
	clients[1].push({ op: 'session_revoked' })
	assert.match(session.getState().error, /ended this session/)
})

test('a bridge restart during connect reports an error instead of failing silently', async () => {
	const { session } = setup(() => ({ handlers: {
		capabilities: (_fields, client) => { client.push({ op: 'station_closed' }); return Promise.reject(new Error('Station connection closed.')) },
	} }))
	await assert.rejects(session.connect(input))
	assert.equal(session.getState().status, 'error')
	assert.match(session.getState().error, /bridge closed while connecting/)
})

test('user cancellation during connect reports nothing', async () => {
	let release
	const { session } = setup({ handlers: { capabilities: () => new Promise((resolve) => { release = resolve }) } })
	const pending = session.connect(input)
	await flush()
	session.disconnect()
	release({ capabilities: {} })
	await assert.rejects(pending, /cancelled/)
	assert.equal(session.getState().status, 'disconnected')
	assert.equal(session.getState().error, null)
})

test('test connection uses a separate socket and leaves the live session untouched', async () => {
	const { session, clients } = setup()
	await session.connect(input)
	const before = session.getState()
	const capabilities = await session.testConnection(input)
	assert.deepEqual(capabilities.operations, ['subscribe'])
	assert.equal(clients.length, 2)
	assert.equal(clients[1].closed, true)
	assert.equal(clients[0].closed, false)
	assert.equal(session.getState(), before)
})

test('session-bound requests reject as not sent after the session changes', async () => {
	const { session } = setup()
	await session.connect(input)
	const { sessionId } = session.getState()
	await session.connect(input)
	await assert.rejects(session.requestForSession(sessionId, 'read', {}), (error) => error.dispatch === 'not-sent')
	session.disconnect()
	await assert.rejects(session.request('read'), (error) => error.dispatch === 'not-sent')
})

test('history cache is pruned to live widget series', async () => {
	const { session } = setup({ handlers: { read_history: () => Promise.resolve({ history: { histories: [{ records: [{ timestamp: 1, value: 2 }] }] } }) } })
	await session.connect(input)
	await session.loadHistory('shape:t1', 'p1', 1000)
	await session.loadHistory('shape:t2', 'p2', 1000)
	assert.deepEqual(Object.keys(session.getState().historySeries).sort(), ['shape:t1:p1', 'shape:t2:p2'])
	session.pruneHistory(new Set(['shape:t1:p1']))
	assert.deepEqual(Object.keys(session.getState().historySeries), ['shape:t1:p1'])
	assert.equal(session.getState().historySeries['shape:t1:p1'].records.length, 1)
})
