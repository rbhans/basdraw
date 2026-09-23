import type { JsonValue } from 'tldraw'
import type {
	AgentConnectionDescription,
	AgentConnectionToolDescription,
	AgentConnectionToolOutcome,
	AgentConnectionToolRisk,
} from '../../shared/connections'
import { getDispatchState, UNKNOWN_WRITE_OUTCOME_NOTE } from '../../shared/connections.ts'
import type { BasdrawAccessPolicy } from '../../shared/access'
import { connectionApprovalRuntime, type ConnectionApprovalVerifier } from './ConnectionApprovalRuntime.ts'

type ToolInput = Record<string, JsonValue>

export type AgentConnectionReadTool = AgentConnectionToolDescription & {
	effect: 'read'
	execute: (input: ToolInput) => Promise<unknown> | unknown
}

/**
 * A write tool is split into phases so the runtime, not the adapter, owns the
 * approval and policy checks that sit between preflight and the mutation.
 */
export type AgentConnectionWriteTool = AgentConnectionToolDescription & {
	effect: 'write'
	/** Validate input and read current state. Must not mutate. Runs for the approval card and again before dispatch. */
	prepare?: (input: ToolInput) => Promise<unknown> | unknown
	/** Send the mutation exactly once. Throw ConnectionDispatchError('not-sent' | 'rejected') when the transport knows it. */
	dispatch: (input: ToolInput, context: { prepared: unknown }) => Promise<unknown>
	/** Optional read-back after dispatch. Errors here never change the outcome. */
	verify?: (input: ToolInput, response: unknown) => Promise<unknown>
	/** Protocol-specific partial-failure detection on the dispatch response. */
	responseHasFailure?: (response: unknown) => boolean
	/** Per-call risk, for example when only some arguments are dangerous. */
	riskFor?: (input: ToolInput) => AgentConnectionToolRisk
	/** Guidance returned to the model with every result. */
	resultNote?: string
}

export type AgentConnectionTool = AgentConnectionReadTool | AgentConnectionWriteTool

export type AgentConnectionAdapter = {
	id: string
	type: string
	label: string
	connected: boolean
	capabilities: readonly string[]
	tools: readonly AgentConnectionTool[]
	knowledgeScopeIds?: readonly string[]
	/** Identifies the live remote session. Required (non-empty) whenever the adapter exposes write tools. */
	sessionId?: string
	/** Non-secret identity for audit logs. Never include credentials. */
	auditIdentity?: { stationAlias?: string, stationEndpoint?: string }
	/** Approval card copy for this connection type. */
	approvalCopy?: { title?: string, previewLabel?: string }
}

export type ConnectionWriteResult = {
	ok: boolean
	outcome: Extract<AgentConnectionToolOutcome, 'succeeded' | 'failed' | 'unknown'>
	response?: unknown
	verification?: unknown
	note?: string
	error?: string
}

export type ConnectionExecuteOptions = {
	access?: BasdrawAccessPolicy['connections']
	/** One-time token from ConnectionApprovalRuntime. Required for write tools. */
	approvalToken?: string
	ownerAgentId?: string
	turnId?: string
	/** Checked immediately before dispatch, after every await. */
	isExecutionAllowed?: () => boolean
}

/** Thrown when the write never reached the connection. */
export class ConnectionNotSentError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'ConnectionNotSentError'
	}
}

/**
 * Runtime-only registry for connection adapters exposed to the canvas agent.
 *
 * Adapters own authentication and protocol details. The model only receives the
 * redacted descriptions returned by describe(), never credentials or clients.
 * Write tools run only with a matching approval token, and the runtime re-checks
 * access, session and cancellation right before handing control to dispatch().
 */
export class ConnectionRuntime {
	private adapters = new Map<string, AgentConnectionAdapter>()
	private approvals: ConnectionApprovalVerifier | null

	constructor(options: { approvals?: ConnectionApprovalVerifier } = {}) {
		this.approvals = options.approvals ?? null
	}

	register(adapter: AgentConnectionAdapter) {
		validateAdapter(adapter)
		this.adapters.set(adapter.id, adapter)
		return () => {
			if (this.adapters.get(adapter.id) === adapter) this.adapters.delete(adapter.id)
		}
	}

	describe(access: BasdrawAccessPolicy['connections'] = 'read'): AgentConnectionDescription[] {
		if (access === 'none') return []
		return [...this.adapters.values()]
			.map((adapter) => ({
				id: adapter.id,
				type: adapter.type,
				label: adapter.label,
				connected: adapter.connected,
				capabilities: [...adapter.capabilities],
				knowledgeScopeIds: [...(adapter.knowledgeScopeIds ?? [adapter.id])],
				tools: adapter.tools.filter((tool) => access === 'write' || tool.effect === 'read').map(describeTool),
			}))
			.sort((a, b) => a.label.localeCompare(b.label))
	}

	async execute(connectionId: string, toolId: string, input: ToolInput, options: ConnectionExecuteOptions = {}): Promise<unknown> {
		const access = options.access ?? 'read'
		if (access === 'none') throw new Error('Connection tools are disabled by the current access profile.')
		const adapter = this.adapters.get(connectionId)
		if (!adapter) throw new Error(`Connection ${connectionId} is not available.`)
		if (!adapter.connected) throw new Error(`${adapter.label} is not connected.`)
		const tool = adapter.tools.find((candidate) => candidate.id === toolId)
		if (!tool) throw new Error(`Tool ${toolId} is not available on ${adapter.label}.`)
		if (tool.effect === 'read') {
			if (options.isExecutionAllowed && !options.isExecutionAllowed()) throw new Error('Operation was cancelled or access changed.')
			return tool.execute(input)
		}

		if (access !== 'write') throw new Error('The current access profile allows read-only connection tools.')
		const sessionId = adapter.sessionId ?? ''
		if (!sessionId) throw new Error(`${adapter.label} has no active session. Reconnect before changing it.`)
		if (!this.approvals) throw new Error('Connection write tools require explicit user confirmation.')
		this.approvals.consume(options.approvalToken, {
			ownerAgentId: options.ownerAgentId ?? '',
			turnId: options.turnId ?? '',
			connectionId,
			toolId,
			sessionId,
			arguments: input,
		})

		const assertAllowed = () => {
			if (options.isExecutionAllowed && !options.isExecutionAllowed()) throw new ConnectionNotSentError('Operation was cancelled or access changed before dispatch.')
			const current = this.adapters.get(connectionId)
			if (!current?.connected || current.sessionId !== sessionId || !current.tools.some(item => item.id === toolId && item.effect === 'write')) {
				throw new ConnectionNotSentError('The connection changed before dispatch. Request approval again.')
			}
		}

		assertAllowed()
		let prepared: unknown
		try {
			prepared = await tool.prepare?.(input)
		} catch (error) {
			throw new ConnectionNotSentError(errorMessage(error))
		}
		assertAllowed()

		let response: unknown
		try {
			response = await tool.dispatch(input, { prepared })
		} catch (error) {
			const state = getDispatchState(error)
			if (state === 'not-sent') throw new ConnectionNotSentError(errorMessage(error))
			if (state === 'rejected') return { ok: false, outcome: 'failed', error: errorMessage(error), note: tool.resultNote } satisfies ConnectionWriteResult
			return { ok: false, outcome: 'unknown', error: errorMessage(error), note: UNKNOWN_WRITE_OUTCOME_NOTE } satisfies ConnectionWriteResult
		}

		let verification: unknown
		if (tool.verify) {
			try {
				verification = await tool.verify(input, response)
			} catch (error) {
				verification = { error: errorMessage(error), note: 'The write was sent. Verification failed; do not retry automatically.' }
			}
		}
		const failed = tool.responseHasFailure?.(response) ?? false
		return { ok: !failed, outcome: failed ? 'failed' : 'succeeded', response, verification, note: tool.resultNote } satisfies ConnectionWriteResult
	}

	getTool(connectionId: string, toolId: string) {
		const adapter = this.adapters.get(connectionId)
		const tool = adapter?.tools.find((candidate) => candidate.id === toolId)
		return adapter && tool ? { adapter, tool } : null
	}

	clear() {
		this.adapters.clear()
	}
}

export const connectionRuntime = new ConnectionRuntime({ approvals: connectionApprovalRuntime })

export function getToolRisk(tool: AgentConnectionTool, input: ToolInput): AgentConnectionToolRisk {
	if (tool.risk === 'high') return 'high'
	if (tool.effect === 'write' && tool.riskFor) {
		try { return tool.riskFor(input) } catch { return 'high' }
	}
	return 'normal'
}

function describeTool(tool: AgentConnectionTool): AgentConnectionToolDescription {
	return {
		id: tool.id,
		description: tool.description,
		...(tool.capability ? { capability: tool.capability } : {}),
		effect: tool.effect,
		...(tool.risk ? { risk: tool.risk } : {}),
		inputSchema: { ...tool.inputSchema },
	}
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}

function validateAdapter(adapter: AgentConnectionAdapter) {
	if (!adapter.id.trim() || !adapter.type.trim() || !adapter.label.trim()) {
		throw new Error('Connection adapters require an id, type and label.')
	}
	const toolIds = adapter.tools.map((tool) => tool.id)
	if (new Set(toolIds).size !== toolIds.length) {
		throw new Error(`Connection adapter ${adapter.id} has duplicate tool ids.`)
	}
	for (const tool of adapter.tools) {
		if (!tool.id.trim() || !tool.description.trim()) {
			throw new Error(`Connection adapter ${adapter.id} has an invalid tool.`)
		}
		if (tool.effect === 'write' && typeof tool.dispatch !== 'function') {
			throw new Error(`Connection adapter ${adapter.id} write tool ${tool.id} has no dispatch step.`)
		}
		if (tool.effect === 'read' && typeof tool.execute !== 'function') {
			throw new Error(`Connection adapter ${adapter.id} read tool ${tool.id} has no execute step.`)
		}
	}
	if (adapter.tools.some((tool) => tool.effect === 'write') && !adapter.sessionId?.trim()) {
		throw new Error(`Connection adapter ${adapter.id} exposes write tools without a session id.`)
	}
}
