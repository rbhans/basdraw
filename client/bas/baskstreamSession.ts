import { ConnectionDispatchError } from '../../shared/connections.ts'
import { PointSnapshotStore } from './pointSnapshotStore.ts'
import type { Capabilities, ConnectionInput, ConnectionProfile, HistoryRecord, HistorySeriesState } from './types'

/**
 * baskStream connection and subscription service. Plain TypeScript: no React,
 * tldraw or DOM dependency, so protocol bookkeeping is testable with a fake client.
 * Persistence (profiles, canvas station alias) stays with the caller.
 */

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
export type SubscriptionHealth = 'idle' | 'live' | 'stale'
type Message = Record<string, unknown>

export type BaskstreamClientLike = {
	connect(input: ConnectionInput): Promise<Message>
	request(op: string, fields?: Message, timeoutMs?: number): Promise<Message>
	onPush(listener: (message: Message) => void): unknown
	close(): void
}

export type BaskstreamSessionState = {
	status: ConnectionStatus
	error: string | null
	health: Record<string, unknown> | null
	capabilities: Capabilities | null
	connectedProfile: ConnectionProfile | null
	/** The last profile used to connect, kept after a disconnect so Reconnect can prefill the form. */
	lastProfile: ConnectionProfile | null
	sessionId: string
	historySeries: Record<string, HistorySeriesState>
	subscriptionHealth: SubscriptionHealth
	subscriptionError: string | null
}

export type SessionTimers = {
	setTimeout(callback: () => void, ms: number): unknown
	clearTimeout(handle: unknown): void
	setInterval(callback: () => void, ms: number): unknown
	clearInterval(handle: unknown): void
}

export const CANVAS_SUBSCRIPTION_GROUP = 'canvas:active'
const RETRY_MIN_MS = 2_000
const RETRY_MAX_MS = 60_000

const defaultTimers: SessionTimers = {
	setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
	clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
	setInterval: (callback, ms) => globalThis.setInterval(callback, ms),
	clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>),
}

const initialState: BaskstreamSessionState = {
	status: 'disconnected', error: null, health: null, capabilities: null, connectedProfile: null, lastProfile: null,
	sessionId: '', historySeries: {}, subscriptionHealth: 'idle', subscriptionError: null,
}

/** One consistent check for the leased view-group API: create, renew and release all use it. */
export function groupsSupported(capabilities: Capabilities | null | undefined) {
	return Boolean(capabilities?.operations?.includes('replace_subscriptions') && capabilities.subscriptions?.viewGroups)
}

export function subscriptionLeaseSec(capabilities: Capabilities | null | undefined) {
	return Math.min(capabilities?.limits?.subscriptionLeaseSec || 300, 300)
}

export function historySeriesKey(widgetId: string, pointReference: string) {
	return `${widgetId}:${pointReference}`
}

export class BaskstreamSession {
	readonly snapshots = new PointSnapshotStore()
	private state = initialState
	private listeners = new Set<() => void>()
	private client: BaskstreamClientLike | null = null
	private attempt = 0
	private activePoints: string[] = []
	/** Direct mode: only points the station confirmed. */
	private subscribed = new Set<string>()
	private pendingSubscribe = new Set<string>()
	private replaceSequence = 0
	private retryTimer: unknown = null
	private retryDelay = RETRY_MIN_MS
	private renewTimer: unknown = null
	private historyRequests = new Map<string, symbol>()

	private readonly createClient: () => BaskstreamClientLike
	private readonly timers: SessionTimers
	private readonly createSessionId: () => string

	constructor(createClient: () => BaskstreamClientLike, timers: SessionTimers = defaultTimers, createSessionId: () => string = () => crypto.randomUUID()) {
		this.createClient = createClient
		this.timers = timers
		this.createSessionId = createSessionId
	}

	getState = () => this.state

	subscribe = (listener: () => void) => {
		this.listeners.add(listener)
		return () => { this.listeners.delete(listener) }
	}

	/** Points that have a confirmed subscription (direct mode) or belong to the confirmed group. */
	get subscribedPoints(): readonly string[] { return [...this.subscribed].sort() }

	async connect(input: ConnectionInput): Promise<{ capabilities: Capabilities; profile: ConnectionProfile }> {
		this.disconnect()
		const attempt = this.attempt
		const client = this.createClient()
		this.client = client
		const profile: ConnectionProfile = { alias: input.alias, name: input.name, stationUrl: input.stationUrl, username: input.username, tlsMode: input.tlsMode }
		this.update({ status: 'connecting', error: null, sessionId: this.createSessionId(), lastProfile: profile })
		client.onPush((message) => this.onPush(client, message))
		try {
			const connected = await client.connect(input)
			if (attempt !== this.attempt || this.client !== client) throw new Error('Connection was cancelled.')
			const response = await client.request('capabilities')
			if (attempt !== this.attempt || this.client !== client) throw new Error('Connection was cancelled.')
			const capabilities = asRecord(response.capabilities) as Capabilities
			this.update({ status: 'connected', error: null, health: asRecord(connected.health), capabilities, connectedProfile: profile, subscriptionHealth: 'live', subscriptionError: null })
			void this.syncSubscriptions()
			this.scheduleRenewal()
			return { capabilities, profile }
		} catch (cause) {
			// A user disconnect or a newer connect supersedes this attempt; it reports nothing.
			if (attempt !== this.attempt) throw cause
			if (this.client === client) this.client = null
			client.close()
			this.teardown()
			// A bridge/station close during connect has already recorded a specific message.
			const error = this.state.status === 'error' && this.state.error ? this.state.error : errorMessage(cause)
			this.update({ status: 'error', error, health: null, capabilities: null, connectedProfile: null, subscriptionHealth: 'idle', subscriptionError: null, historySeries: {} })
			throw cause
		}
	}

	/** Verify credentials and capabilities on a separate socket. No state, profile or canvas writes. */
	async testConnection(input: ConnectionInput): Promise<Capabilities> {
		const client = this.createClient()
		try {
			await client.connect(input)
			const response = await client.request('capabilities')
			return asRecord(response.capabilities) as Capabilities
		} finally {
			client.close()
		}
	}

	disconnect() {
		this.attempt++
		const client = this.client
		this.client = null
		if (client && groupsSupported(this.state.capabilities)) {
			void client.request('release_subscriptions', { group: CANVAS_SUBSCRIPTION_GROUP }, 3_000).catch(() => undefined)
		}
		client?.close()
		this.teardown()
		this.update({ status: 'disconnected', error: null, health: null, capabilities: null, connectedProfile: null, subscriptionHealth: 'idle', subscriptionError: null, historySeries: {} })
	}

	dispose() {
		this.disconnect()
		this.listeners.clear()
	}

	clearError() {
		if (this.state.error) this.update({ error: null })
	}

	reportError(message: string) {
		this.update({ error: message })
	}

	request(op: string, fields: Message = {}, timeoutMs?: number): Promise<Message> {
		const client = this.client
		if (!client) return Promise.reject(new ConnectionDispatchError('Connect to a station first.', 'not-sent'))
		return client.request(op, fields, timeoutMs).then((response) => {
			if (client !== this.client) throw new ConnectionDispatchError('Station connection changed during the request. Check the original station before retrying a write.', 'unknown')
			return response
		})
	}

	requestForSession(expectedSession: string, op: string, fields: Message) {
		if (!expectedSession || expectedSession !== this.state.sessionId || !this.client) {
			return Promise.reject(new ConnectionDispatchError('The station session changed. Request approval again.', 'not-sent'))
		}
		return this.request(op, fields)
	}

	/** Returns true while `client` is still the live connection. */
	isCurrent(client: unknown) { return client !== null && client === this.client }
	get currentClient() { return this.client }

	/** Desired point set for the open canvas; the service reconciles subscriptions. */
	setActivePoints(points: readonly string[]) {
		const next = [...new Set(points)].sort()
		if (next.length === this.activePoints.length && next.every((point, index) => point === this.activePoints[index])) return
		this.activePoints = next
		void this.syncSubscriptions()
	}

	async syncSubscriptions(): Promise<void> {
		const client = this.client
		if (!client || this.state.status !== 'connected') return
		const capabilities = this.state.capabilities
		if (groupsSupported(capabilities)) {
			const sequence = ++this.replaceSequence
			const points = this.activePoints
			try {
				const response = await client.request('replace_subscriptions', { group: CANVAS_SUBSCRIPTION_GROUP, points, leaseSec: subscriptionLeaseSec(capabilities) })
				if (client !== this.client || sequence !== this.replaceSequence) return
				this.subscribed = new Set(points)
				this.snapshots.ingest(response.points)
				this.markLive()
			} catch (cause) {
				if (client !== this.client || sequence !== this.replaceSequence) return
				this.markStale(cause)
			}
			return
		}
		const desired = new Set(this.activePoints)
		const removed = [...this.subscribed].filter((point) => !desired.has(point))
		for (const point of removed) this.subscribed.delete(point)
		if (removed.length) void client.request('unsubscribe', { points: removed }).catch(() => undefined)
		const added = this.activePoints.filter((point) => !this.subscribed.has(point) && !this.pendingSubscribe.has(point))
		if (!added.length) {
			if (this.pendingSubscribe.size === 0 && this.state.subscriptionHealth === 'stale' && !this.retryTimer) this.markLive()
			return
		}
		for (const point of added) this.pendingSubscribe.add(point)
		try {
			const response = await client.request('subscribe', { points: added })
			if (client !== this.client) return
			for (const point of added) this.pendingSubscribe.delete(point)
			const stillWanted = new Set(this.activePoints)
			const unwanted = added.filter((point) => !stillWanted.has(point))
			for (const point of added) if (stillWanted.has(point)) this.subscribed.add(point)
			if (unwanted.length) void client.request('unsubscribe', { points: unwanted }).catch(() => undefined)
			this.snapshots.ingest(response.points)
			if (this.activePoints.every((point) => this.subscribed.has(point) || this.pendingSubscribe.has(point))) this.markLive()
		} catch (cause) {
			if (client !== this.client) return
			for (const point of added) this.pendingSubscribe.delete(point)
			this.markStale(cause)
		}
	}

	async loadHistory(widgetId: string, pointReference: string, rangeMs: number) {
		const client = this.client
		if (!client) return
		const key = historySeriesKey(widgetId, pointReference)
		const requestId = Symbol()
		this.historyRequests.set(key, requestId)
		const current = this.state.historySeries[key]
		this.setHistory(key, { ...current, loading: true, error: undefined, records: current?.records || [] })
		const end = Date.now()
		const start = end - rangeMs
		try {
			const response = await this.request('read_history', { ord: pointReference, start, end, limit: 2_000 }, 25_000)
			if (client !== this.client || this.historyRequests.get(key) !== requestId) return
			const history = asRecord(response.history)
			const histories = Array.isArray(history.histories) ? history.histories : []
			const first = asRecord(histories[0])
			const records = Array.isArray(first.records)
				? first.records.map(asHistoryRecord).filter((record): record is HistoryRecord => Boolean(record))
				: []
			this.setHistory(key, {
				loading: false,
				records,
				display: typeof first.display === 'string' ? first.display : undefined,
				historyOrd: typeof first.historyOrd === 'string' ? first.historyOrd : undefined,
				start,
				end,
			})
		} catch (cause) {
			if (client !== this.client || this.historyRequests.get(key) !== requestId) return
			this.setHistory(key, { loading: false, error: errorMessage(cause), records: this.state.historySeries[key]?.records || [], start, end })
		}
	}

	/** Drop cached chart samples for widgets or series that no longer exist. */
	pruneHistory(liveKeys: ReadonlySet<string>) {
		const entries = Object.entries(this.state.historySeries)
		const kept = entries.filter(([key]) => liveKeys.has(key))
		for (const key of this.historyRequests.keys()) if (!liveKeys.has(key)) this.historyRequests.delete(key)
		if (kept.length !== entries.length) this.update({ historySeries: Object.fromEntries(kept) })
	}

	private onPush(client: BaskstreamClientLike, message: Message) {
		if (client !== this.client) return
		switch (message.op) {
			case 'cov':
				this.snapshots.ingest(message.points)
				return
			case 'subscriptions_revoked': {
				const points = Array.isArray(message.points) ? message.points.filter((point): point is string => typeof point === 'string') : []
				for (const point of points) this.subscribed.delete(point)
				this.update({ error: `Niagara revoked ${points.length} active point subscription${points.length === 1 ? '' : 's'}.` })
				this.markStale(new Error('Niagara revoked point subscriptions.'))
				return
			}
			case 'error':
				// Unsolicited bridge/station errors have no request id; surface them without ending the session.
				this.update({ error: String(message.message || message.code || 'baskStream reported an error.') })
				return
			case 'session_revoked':
				this.endSession(client, 'Niagara ended this session. Reconnect to resume live values.')
				return
			case 'station_closed':
				this.endSession(client, this.state.status === 'connecting'
					? 'The local baskStream bridge closed while connecting. Check that npm run dev is still running, then reconnect.'
					: 'The station connection closed. Live values stopped; reconnect to resume.')
				return
		}
	}

	private endSession(client: BaskstreamClientLike, error: string) {
		this.client = null
		client.close()
		this.teardown()
		this.update({ status: 'error', error, health: null, capabilities: null, connectedProfile: null, subscriptionHealth: 'idle', subscriptionError: null, historySeries: {} })
	}

	private scheduleRenewal() {
		if (!groupsSupported(this.state.capabilities)) return
		const leaseSec = subscriptionLeaseSec(this.state.capabilities)
		const client = this.client
		this.renewTimer = this.timers.setInterval(() => {
			if (!client || client !== this.client) return
			client.request('renew_subscriptions', { group: CANVAS_SUBSCRIPTION_GROUP, leaseSec }).catch((cause) => {
				if (client !== this.client) return
				// The lease may have lapsed; recreate the group rather than let values freeze while "connected".
				this.markStale(cause)
				void this.syncSubscriptions()
			})
		}, Math.max(30, Math.floor(leaseSec * 0.7)) * 1_000)
	}

	private markLive() {
		this.retryDelay = RETRY_MIN_MS
		if (this.state.subscriptionHealth !== 'live' || this.state.subscriptionError) this.update({ subscriptionHealth: 'live', subscriptionError: null })
	}

	private markStale(cause: unknown) {
		this.update({ subscriptionHealth: 'stale', subscriptionError: errorMessage(cause) })
		if (this.retryTimer !== null || !this.client) return
		const delay = this.retryDelay
		this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX_MS)
		this.retryTimer = this.timers.setTimeout(() => {
			this.retryTimer = null
			void this.syncSubscriptions()
		}, delay)
	}

	private teardown() {
		if (this.retryTimer !== null) this.timers.clearTimeout(this.retryTimer)
		if (this.renewTimer !== null) this.timers.clearInterval(this.renewTimer)
		this.retryTimer = null
		this.renewTimer = null
		this.retryDelay = RETRY_MIN_MS
		this.replaceSequence++
		this.subscribed.clear()
		this.pendingSubscribe.clear()
		this.historyRequests.clear()
		this.snapshots.clear()
	}

	private setHistory(key: string, value: HistorySeriesState) {
		this.update({ historySeries: { ...this.state.historySeries, [key]: value } })
	}

	private update(patch: Partial<BaskstreamSessionState>) {
		this.state = { ...this.state, ...patch }
		for (const listener of [...this.listeners]) listener()
	}
}

export function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function errorMessage(cause: unknown) {
	return cause instanceof Error ? cause.message : String(cause)
}

function asHistoryRecord(value: unknown): HistoryRecord | null {
	const record = asRecord(value)
	if (typeof record.timestamp !== 'number') return null
	return {
		timestamp: record.timestamp,
		value: record.value,
		valueType: typeof record.valueType === 'string' ? record.valueType : undefined,
		status: typeof record.status === 'string' ? record.status : undefined,
		recordType: typeof record.recordType === 'string' ? record.recordType : undefined,
	}
}
