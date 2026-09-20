import type { JsonValue } from 'tldraw'
import type { ConnectionToolAction } from '../../shared/schema/AgentActionSchemas'
import type { AgentConnectionToolResult } from '../../shared/connections'
import type { Streaming } from '../../shared/types/Streaming'
import { connectionRuntime } from '../connections/ConnectionRuntime'
import { connectionApprovalRuntime } from '../connections/ConnectionApprovalRuntime'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'

const MAX_RESULT_CHARACTERS = 40_000

export const ConnectionToolActionUtil = registerActionUtil(
	class ConnectionToolActionUtil extends AgentActionUtil<ConnectionToolAction> {
		static override type = 'connectionTool' as const

		override getInfo(action: Streaming<ConnectionToolAction>) {
			return {
				icon: 'search' as const,
				description: action.complete
					? `Used ${action.toolId || 'connection tool'}`
					: `Using ${action.toolId || 'connection tool'}`,
			}
		}

		override async applyAction(action: Streaming<ConnectionToolAction>) {
			if (!action.complete) return
			let result: AgentConnectionToolResult
			try {
				const access = this.agent.getAccessPolicy().connections
				const installed = connectionRuntime.getTool(action.connectionId, action.toolId)
				if (!installed) throw new Error(`Connection tool ${action.connectionId}:${action.toolId} is not available.`)
				let confirmedWrite = false
				if (installed.tool.effect === 'write') {
					if (access !== 'write') throw new Error('The current access profile allows read-only connection tools.')
					confirmedWrite = await connectionApprovalRuntime.request({
						ownerAgentId: this.agent.id,
						connectionId: installed.adapter.id,
						connectionLabel: installed.adapter.label,
						toolId: installed.tool.id,
						toolDescription: installed.tool.description,
						arguments: action.arguments ?? {},
					})
					if (!confirmedWrite) throw new Error('Connection write was not approved.')
				}
				const value = await connectionRuntime.execute(
					action.connectionId,
					action.toolId,
					action.arguments ?? {},
					{ access, confirmedWrite },
				)
				result = {
					kind: 'connection-tool-result',
					connectionId: action.connectionId,
					toolId: action.toolId,
					ok: true,
					data: toBoundedJson(value),
				}
			} catch (cause) {
				result = {
					kind: 'connection-tool-result',
					connectionId: action.connectionId,
					toolId: action.toolId,
					ok: false,
					error: cause instanceof Error ? cause.message : String(cause),
				}
			}
			this.agent.schedule({ data: [result] })
		}
	}
)

function toBoundedJson(value: unknown): JsonValue {
	let serialized: string
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
