import type { ConnectionToolAction } from '../../shared/schema/AgentActionSchemas'
import type { Streaming } from '../../shared/types/Streaming'
import { connectionRuntime } from '../connections/ConnectionRuntime'
import { connectionApprovalRuntime } from '../connections/ConnectionApprovalRuntime'
import { fetchConnectionAuditClient, runConnectionToolCall } from '../connections/runConnectionToolCall'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'
import { getProjectId } from '../knowledge/currentKnowledgeScope'

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
			const generation = this.agent.getCancellationGeneration()
			const projectId = getProjectId(this.editor)
			const isCurrent = () => generation === this.agent.getCancellationGeneration() && projectId === getProjectId(this.editor)
			const result = await runConnectionToolCall(
				{ connectionId: action.connectionId, toolId: action.toolId, arguments: action.arguments ?? {} },
				{
					runtime: connectionRuntime,
					approvals: connectionApprovalRuntime,
					audit: fetchConnectionAuditClient,
					ownerAgentId: this.agent.id,
					// The cancellation generation changes whenever the turn is cancelled or superseded.
					turnId: String(generation),
					projectId,
					getAccess: () => this.agent.getAccessPolicy().connections,
					isCurrent,
				},
			)
			if (isCurrent()) this.agent.schedule({ data: [result] })
		}
	}
)
