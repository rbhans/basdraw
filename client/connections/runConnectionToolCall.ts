import type { JsonValue } from 'tldraw'
import type { BasdrawAccessPolicy } from '../../shared/access'
import type { AgentConnectionToolOutcome, AgentConnectionToolResult, ConnectionAuditState } from '../../shared/connections'
import type { ConnectionApprovalDecision, ConnectionApprovalRuntime } from './ConnectionApprovalRuntime'
import { getToolRisk, type ConnectionRuntime, type ConnectionWriteResult } from './ConnectionRuntime.ts'

export const MAX_RESULT_CHARACTERS = 40_000
export const MAX_ERROR_CHARACTERS = 1_000

export type ConnectionAuditRecord = {
	id: string
	projectId: string
	connectionId: string
	connectionLabel: string
	toolId: string
	arguments: Record<string, JsonValue>
	sessionId: string
	stationAlias?: string
	stationEndpoint?: string
	/** SHA-256 hex of the canonical approved arguments (field name used by worker/routes/connectionAudit.ts). */
	argumentsHash?: string
}

export type ConnectionAuditClient = {
	/** Resolves with the HTTP status, or 0 when the request itself failed. */
	create: (record: ConnectionAuditRecord) => Promise<{ ok: boolean, status: number }>
	finish: (id: string, update: { state: Exclude<ConnectionAuditState, 'approved'>, result: JsonValue }) => Promise<boolean>
}

export type ConnectionToolCall = {
	connectionId: string
	toolId: string
	arguments: Record<string, JsonValue>
}

export type ConnectionToolCallContext = {
	runtime: ConnectionRuntime
	approvals: Pick<ConnectionApprovalRuntime, 'request' | 'revoke'>
	audit: ConnectionAuditClient
	ownerAgentId: string
	/** The agent turn this call belongs to. Approvals are bound to it. */
	turnId: string
	projectId: string
	getAccess: () => BasdrawAccessPolicy['connections']
	/** False once the turn was cancelled/superseded or the project changed. */
	isCurrent: () => boolean
	createId?: () => string
}

/**
 * Runs one agent connection tool call. For writes the order is fixed:
 * preflight -> user approval (one-time token) -> audit row saved -> execute.
 * If the audit row cannot be saved, nothing is sent to the connection.
 */
export async function runConnectionToolCall(call: ConnectionToolCall, context: ConnectionToolCallContext): Promise<AgentConnectionToolResult> {
	const base = { kind: 'connection-tool-result' as const, connectionId: call.connectionId, toolId: call.toolId }
	const fail = (message: string, outcome: AgentConnectionToolOutcome = 'not-sent'): AgentConnectionToolResult => ({ ...base, ok: false, outcome, error: capError(message) })
	const args = call.arguments ?? {}
	const installed = context.runtime.getTool(call.connectionId, call.toolId)
	if (!installed) return fail(`Connection tool ${call.connectionId}:${call.toolId} is not available.`)
	const { adapter, tool } = installed

	if (tool.effect === 'read') {
		try {
			const value = await context.runtime.execute(call.connectionId, call.toolId, args, {
				access: context.getAccess(),
				isExecutionAllowed: () => context.isCurrent() && context.getAccess() !== 'none',
			})
			// Adapters normalize their protocol's partial failures to top-level ok.
			return { ...base, ok: !(value && typeof value === 'object' && 'ok' in value && value.ok === false), data: toBoundedJson(value) }
		} catch (error) {
			return fail(errorMessage(error), 'failed')
		}
	}

	if (context.getAccess() !== 'write') return fail('The current access profile allows read-only connection tools.')
	const sessionId = adapter.sessionId ?? ''
	if (!sessionId) return fail(`${adapter.label} has no active session. Reconnect before changing it.`)

	let preview: JsonValue | undefined
	try {
		const prepared = await tool.prepare?.(args)
		preview = prepared === undefined ? undefined : toBoundedJson(prepared)
	} catch (error) {
		return fail(errorMessage(error))
	}
	if (!context.isCurrent()) return fail('Operation was cancelled before approval.')
	if (context.getAccess() !== 'write') return fail('Connection writes are no longer enabled.')

	const decision = await context.approvals.request({
		ownerAgentId: context.ownerAgentId,
		turnId: context.turnId,
		connectionId: adapter.id,
		connectionLabel: adapter.label,
		toolId: tool.id,
		toolDescription: tool.description,
		sessionId,
		arguments: args,
		preview,
		risk: getToolRisk(tool, args),
		title: adapter.approvalCopy?.title,
		previewLabel: adapter.approvalCopy?.previewLabel,
		isCurrent: () => context.isCurrent() && context.getAccess() === 'write',
	})
	if (!decision.approved) return fail(declinedMessage(decision.reason))

	const auditId = context.createId?.() ?? crypto.randomUUID()
	let created: { ok: boolean, status: number }
	try {
		created = await context.audit.create({
			id: auditId,
			projectId: context.projectId,
			connectionId: adapter.id,
			connectionLabel: adapter.label,
			toolId: tool.id,
			arguments: args,
			sessionId,
			...(adapter.auditIdentity?.stationAlias ? { stationAlias: adapter.auditIdentity.stationAlias } : {}),
			...(adapter.auditIdentity?.stationEndpoint ? { stationEndpoint: adapter.auditIdentity.stationEndpoint } : {}),
			...(/^[0-9a-f]{64}$/.test(decision.argsHash) ? { argumentsHash: decision.argsHash } : {}),
		})
	} catch {
		created = { ok: false, status: 0 }
	}
	if (!created.ok) {
		context.approvals.revoke(decision.token)
		return fail(auditFailureMessage(created.status))
	}

	let result: AgentConnectionToolResult
	let state: Exclude<ConnectionAuditState, 'approved'>
	if (!context.isCurrent()) {
		context.approvals.revoke(decision.token)
		result = fail('Operation was cancelled before execution.')
		state = 'cancelled'
	} else {
		try {
			const value = await context.runtime.execute(call.connectionId, call.toolId, args, {
				access: context.getAccess(),
				approvalToken: decision.token,
				ownerAgentId: context.ownerAgentId,
				turnId: context.turnId,
				isExecutionAllowed: () => context.isCurrent() && context.getAccess() === 'write',
			}) as ConnectionWriteResult
			state = value.outcome
			const { error, note, ...data } = value
			result = {
				...base,
				ok: value.ok,
				outcome: value.outcome,
				data: toBoundedJson(data),
				...(error ? { error: capError(error) } : {}),
				...(note ? { note: capError(note) } : {}),
			}
		} catch (error) {
			// Everything the runtime throws for writes happens before dispatch.
			state = context.isCurrent() ? 'failed' : 'cancelled'
			result = fail(errorMessage(error))
		}
	}

	let saved = false
	try {
		saved = await context.audit.finish(auditId, { state, result: toBoundedJson(result) })
	} catch {
		saved = false
	}
	if (!saved) result.error = capError(`${result.error ?? ''} Write-log completion could not be saved; inspect the station before retrying.`.trim())
	return result
}

/** Browser audit client for worker/routes/connectionAudit.ts. */
export const fetchConnectionAuditClient: ConnectionAuditClient = {
	async create(record) {
		const response = await fetch('/api/connection-audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record) })
		return { ok: response.ok, status: response.status }
	},
	async finish(id, update) {
		const response = await fetch(`/api/connection-audit/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(update) })
		return response.ok
	},
}

export function auditFailureMessage(status: number) {
	const prefix = 'The write log could not be saved, so no station change was sent.'
	if (status === 403) return `${prefix} Connection writes are only available from the local basdraw app.`
	if (status === 401) return `${prefix} This session is not authorized to record connection writes.`
	if (status === 400 || status === 413) return `${prefix} The write log rejected the request as invalid or too large.`
	if (status === 0) return `${prefix} The app server could not be reached. Check that it is running and retry.`
	if (status >= 500) return `${prefix} The server failed to store it (HTTP ${status}). If the write-log table is missing, run the database migrations (npm run knowledge:migrate) and retry.`
	return `${prefix} Unexpected response (HTTP ${status}).`
}

function declinedMessage(reason: Extract<ConnectionApprovalDecision, { approved: false }>['reason']) {
	if (reason === 'expired') return 'The approval request expired before the user answered. Nothing was sent. Ask the user again if the change is still needed.'
	if (reason === 'denied') return 'Connection write was not approved. Nothing was sent.'
	return 'The approval request was cancelled. Nothing was sent.'
}

export function capError(message: string) {
	return message.length <= MAX_ERROR_CHARACTERS ? message : `${message.slice(0, MAX_ERROR_CHARACTERS)}… [truncated ${message.length - MAX_ERROR_CHARACTERS} characters]`
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}

export function toBoundedJson(value: unknown): JsonValue {
	let serialized: string | undefined
	try {
		serialized = JSON.stringify(value)
	} catch {
		return { truncated: false, error: 'The connection returned data that could not be serialized.' }
	}
	if (serialized === undefined) return null
	if (serialized.length <= MAX_RESULT_CHARACTERS) return JSON.parse(serialized) as JsonValue
	return {
		truncated: true,
		originalCharacters: serialized.length,
		preview: serialized.slice(0, MAX_RESULT_CHARACTERS),
	}
}
