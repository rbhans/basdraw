import type { JsonValue } from 'tldraw'
import type { AgentConnectionToolRisk } from '../../shared/connections'
import { canonicalJson, hashCanonicalJson } from '../../shared/connections.ts'

/** How long an approval card can wait for the user before it expires. */
export const APPROVAL_REQUEST_TTL_MS = 5 * 60_000
/** How long an issued approval token stays valid before execute must consume it. */
export const APPROVAL_TOKEN_TTL_MS = 2 * 60_000

/** Everything an approval is bound to. execute() must present the same values. */
export type ConnectionApprovalBinding = {
	ownerAgentId: string
	/** Identifies the agent turn that asked; a superseded turn cannot use the approval. */
	turnId: string
	connectionId: string
	toolId: string
	sessionId: string
	arguments: Record<string, JsonValue>
}

export type PendingConnectionApproval = {
	id: string
	ownerAgentId: string
	turnId: string
	sessionId: string
	connectionId: string
	connectionLabel: string
	toolId: string
	toolDescription: string
	arguments: Record<string, JsonValue>
	/** Read-only preflight state from the adapter, if it has any. */
	preview?: JsonValue
	risk: AgentConnectionToolRisk
	/** Card title from adapter metadata, for example "Allow station change?". */
	title?: string
	/** Label for the preview section from adapter metadata. */
	previewLabel?: string
	expiresAt: number
	status: 'pending' | 'expired'
}

export type ConnectionApprovalRequest = ConnectionApprovalBinding & {
	connectionLabel: string
	toolDescription: string
	preview?: JsonValue
	risk?: AgentConnectionToolRisk
	title?: string
	previewLabel?: string
	/** Checked again when the user clicks approve; false means the turn was superseded. */
	isCurrent?: () => boolean
}

export type ConnectionApprovalDecision =
	| { approved: true, token: string, argsHash: string }
	| { approved: false, reason: 'denied' | 'cancelled' | 'expired' | 'superseded' }

type PendingEntry = PendingConnectionApproval & {
	canonicalArguments: string
	argsHash: string
	isCurrent?: () => boolean
	settle: (decision: ConnectionApprovalDecision) => void
	timer?: ReturnType<typeof setTimeout>
}

type Grant = Omit<ConnectionApprovalBinding, 'arguments'> & { canonicalArguments: string, expiresAt: number }

/** Exposes token consumption to ConnectionRuntime without the UI-facing surface. */
export type ConnectionApprovalVerifier = {
	consume: (token: string | undefined, binding: ConnectionApprovalBinding) => void
}

/**
 * UI-neutral confirmation boundary for agent-initiated connection writes.
 *
 * A user approval produces a one-time token bound to the agent, turn, connection,
 * tool, station session and exact canonical arguments. ConnectionRuntime.execute
 * refuses write tools unless it can consume a matching, unexpired token, so a
 * caller cannot skip confirmation by passing a flag.
 */
export class ConnectionApprovalRuntime implements ConnectionApprovalVerifier {
	private pending = new Map<string, PendingEntry>()
	private grants = new Map<string, Grant>()
	private listeners = new Set<() => void>()
	private snapshot: PendingConnectionApproval[] = []
	private sequence = 0
	private now: () => number
	private requestTtlMs: number
	private tokenTtlMs: number

	constructor(options: { now?: () => number, requestTtlMs?: number, tokenTtlMs?: number } = {}) {
		this.now = options.now ?? Date.now
		this.requestTtlMs = options.requestTtlMs ?? APPROVAL_REQUEST_TTL_MS
		this.tokenTtlMs = options.tokenTtlMs ?? APPROVAL_TOKEN_TTL_MS
	}

	async request(input: ConnectionApprovalRequest): Promise<ConnectionApprovalDecision> {
		if (!input.sessionId) return { approved: false, reason: 'cancelled' }
		const canonicalArguments = canonicalJson(input.arguments)
		const argsHash = await hashCanonicalJson(input.arguments)
		if (input.isCurrent && !input.isCurrent()) return { approved: false, reason: 'superseded' }
		const id = `connection-approval-${this.now()}-${++this.sequence}`
		return new Promise<ConnectionApprovalDecision>((settle) => {
			const { isCurrent, risk, ...rest } = input
			const entry: PendingEntry = {
				...rest,
				arguments: JSON.parse(canonicalArguments) as Record<string, JsonValue>,
				risk: risk ?? 'normal',
				id,
				canonicalArguments,
				argsHash,
				isCurrent,
				settle,
				expiresAt: this.now() + this.requestTtlMs,
				status: 'pending',
			}
			entry.timer = setTimeout(() => this.expire(id), this.requestTtlMs)
			;(entry.timer as { unref?: () => void }).unref?.()
			this.pending.set(id, entry)
			this.emit()
		})
	}

	/** Approve (true) or deny (false) a pending card. Expired or superseded cards cannot be approved. */
	resolve(id: string, approved: boolean) {
		const entry = this.pending.get(id)
		if (!entry || entry.status !== 'pending') return
		if (this.now() >= entry.expiresAt) return this.expire(id)
		if (!approved) return this.finish(entry, { approved: false, reason: 'denied' })
		if (entry.isCurrent && !entry.isCurrent()) return this.finish(entry, { approved: false, reason: 'superseded' })
		const token = globalThis.crypto?.randomUUID?.() ?? `${this.now()}-${Math.random().toString(36).slice(2)}-${this.sequence}`
		this.grants.set(token, {
			ownerAgentId: entry.ownerAgentId,
			turnId: entry.turnId,
			connectionId: entry.connectionId,
			toolId: entry.toolId,
			sessionId: entry.sessionId,
			canonicalArguments: entry.canonicalArguments,
			expiresAt: this.now() + this.tokenTtlMs,
		})
		this.finish(entry, { approved: true, token, argsHash: entry.argsHash })
	}

	/** Remove an expired card from view. */
	dismiss(id: string) {
		const entry = this.pending.get(id)
		if (!entry) return
		if (entry.status === 'pending') return this.resolve(id, false)
		this.pending.delete(id)
		this.emit()
	}

	/**
	 * Cancel every open card and revoke every unused token for an agent.
	 * Called when the agent is cancelled or interrupted, or its access is reduced.
	 */
	cancelOwner(ownerAgentId: string) {
		let changed = false
		for (const entry of [...this.pending.values()]) {
			if (entry.ownerAgentId !== ownerAgentId) continue
			changed = true
			if (entry.timer) clearTimeout(entry.timer)
			this.pending.delete(entry.id)
			if (entry.status === 'pending') entry.settle({ approved: false, reason: 'cancelled' })
		}
		for (const [token, grant] of this.grants) {
			if (grant.ownerAgentId === ownerAgentId) this.grants.delete(token)
		}
		if (changed) this.emit()
	}

	/** Revoke a token that will not be used, for example when the audit log cannot be written. */
	revoke(token: string) {
		this.grants.delete(token)
	}

	/** Single use: the token is removed before any binding is checked. */
	consume(token: string | undefined, binding: ConnectionApprovalBinding) {
		if (!token) throw new Error('Connection write tools require explicit user confirmation.')
		const grant = this.grants.get(token)
		this.grants.delete(token)
		if (!grant) throw new Error('This approval was already used, cancelled or never issued. Request approval again.')
		if (this.now() >= grant.expiresAt) throw new Error('This approval expired. Request approval again.')
		if (grant.ownerAgentId !== binding.ownerAgentId || grant.turnId !== binding.turnId) {
			throw new Error('This approval belongs to a different or superseded request. Request approval again.')
		}
		if (grant.connectionId !== binding.connectionId || grant.toolId !== binding.toolId) {
			throw new Error('This approval was for a different connection tool. Request approval again.')
		}
		if (!binding.sessionId || grant.sessionId !== binding.sessionId) {
			throw new Error('The connection changed. Request approval again for the current station.')
		}
		if (grant.canonicalArguments !== canonicalJson(binding.arguments)) {
			throw new Error('The request changed after approval. Request approval again.')
		}
	}

	getSnapshot = () => this.snapshot

	subscribe = (listener: () => void) => {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	private expire(id: string) {
		const entry = this.pending.get(id)
		if (!entry || entry.status !== 'pending') return
		if (entry.timer) clearTimeout(entry.timer)
		entry.status = 'expired'
		entry.settle({ approved: false, reason: 'expired' })
		this.emit()
	}

	private finish(entry: PendingEntry, decision: ConnectionApprovalDecision) {
		if (entry.timer) clearTimeout(entry.timer)
		this.pending.delete(entry.id)
		entry.settle(decision)
		this.emit()
	}

	private emit() {
		this.snapshot = [...this.pending.values()].map(({ settle: _settle, isCurrent: _isCurrent, timer: _timer, canonicalArguments: _canonical, argsHash: _hash, ...entry }) => entry)
		for (const listener of this.listeners) listener()
	}
}

export const connectionApprovalRuntime = new ConnectionApprovalRuntime()
