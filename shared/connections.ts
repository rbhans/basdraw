import type { JsonValue } from 'tldraw'

export type AgentConnectionToolEffect = 'read' | 'write'

/** How strongly the approval card should warn before a write is allowed. */
export type AgentConnectionToolRisk = 'normal' | 'high'

export type AgentConnectionToolDescription = {
	id: string
	description: string
	capability?: string
	effect: AgentConnectionToolEffect
	/** Optional for writes; high-risk tools show a stronger warning before approval. */
	risk?: AgentConnectionToolRisk
	inputSchema: Record<string, string>
}

export type AgentConnectionDescription = {
	id: string
	type: string
	label: string
	connected: boolean
	capabilities: string[]
	tools: AgentConnectionToolDescription[]
	/** Stable instance IDs for connection-specific knowledge, never credentials. */
	knowledgeScopeIds?: string[]
}

/**
 * Outcome of a connection tool call.
 * - `succeeded` / `failed`: the connection reported a definite result.
 * - `not-sent`: the call failed before anything was dispatched to the connection.
 * - `unknown`: the call was dispatched but no definite answer arrived (timeout,
 *   dropped socket). The remote system may have applied it.
 */
export type AgentConnectionToolOutcome = 'succeeded' | 'failed' | 'not-sent' | 'unknown'

export type AgentConnectionToolResult = {
	kind: 'connection-tool-result'
	connectionId: string
	toolId: string
	ok: boolean
	outcome?: AgentConnectionToolOutcome
	data?: JsonValue
	error?: string
	note?: string
}

/** Audit log states shared with worker/routes/connectionAudit.ts. */
export type ConnectionAuditState = 'approved' | 'succeeded' | 'failed' | 'unknown' | 'cancelled'

export const UNKNOWN_WRITE_OUTCOME_NOTE = 'The station may have applied this write. Do not retry; read the point back first.'

/**
 * Transport errors that know whether a request left the client.
 * Adapters throw these so the runtime can tell "not sent" from "sent, outcome unknown".
 * Untagged errors thrown while dispatching a write are treated as `unknown`.
 */
export class ConnectionDispatchError extends Error {
	readonly dispatch: 'not-sent' | 'rejected' | 'unknown'
	constructor(message: string, dispatch: 'not-sent' | 'rejected' | 'unknown') {
		super(message)
		this.name = 'ConnectionDispatchError'
		this.dispatch = dispatch
	}
}

export function getDispatchState(error: unknown): 'not-sent' | 'rejected' | 'unknown' {
	if (error instanceof ConnectionDispatchError) return error.dispatch
	if (error && typeof error === 'object' && (error as { name?: unknown }).name === 'ConnectionDispatchError') {
		const dispatch = (error as { dispatch?: unknown }).dispatch
		if (dispatch === 'not-sent' || dispatch === 'rejected') return dispatch
	}
	return 'unknown'
}

/** Deterministic JSON with sorted object keys, used to bind approvals to exact arguments. */
export function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== 'object') {
		const serialized = JSON.stringify(value)
		return serialized === undefined ? 'null' : serialized
	}
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
	const record = value as Record<string, unknown>
	return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

/** Lowercase SHA-256 hex of canonicalJson(value); `fnv1a64:`-prefixed only where SubtleCrypto is unavailable. */
export async function hashCanonicalJson(value: unknown): Promise<string> {
	const text = canonicalJson(value)
	const subtle = globalThis.crypto?.subtle
	if (subtle) {
		const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text))
		return `${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
	}
	// Insecure contexts have no SubtleCrypto. Approval binding compares the full canonical
	// text, so this fallback only labels audit rows.
	let hash = 0xcbf29ce484222325n
	for (const byte of new TextEncoder().encode(text)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n)
	return `fnv1a64:${hash.toString(16).padStart(16, '0')}`
}
