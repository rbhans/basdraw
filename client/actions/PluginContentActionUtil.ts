import type { PluginContentAction } from '../../shared/schema/AgentActionSchemas'
import type { Streaming } from '../../shared/types/Streaming'
import type { AgentHelpers } from '../AgentHelpers'
import { agentPluginRuntime } from '../plugins/AgentPluginRuntime'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'

export const PluginContentActionUtil = registerActionUtil(
	class PluginContentActionUtil extends AgentActionUtil<PluginContentAction> {
		static override type = 'pluginContent' as const

		override getInfo(action: Streaming<PluginContentAction>) {
			return {
				icon: 'pencil' as const,
				description: action.complete
					? action.intent || `Used ${action.pluginId}:${action.capabilityId}`
					: `Preparing ${action.capabilityId || 'plugin content'}`,
			}
		}

		override applyAction(action: Streaming<PluginContentAction>, helpers: AgentHelpers) {
			if (!action.complete) return
			if (this.agent.getAccessPolicy().ai !== 'act' || this.agent.getAccessPolicy().canvas !== 'write') {
				throw new Error('The current access profile does not allow canvas changes.')
			}
			const position = typeof action.x === 'number' && typeof action.y === 'number'
				? helpers.removeOffsetFromVec({ x: action.x, y: action.y })
				: null
			agentPluginRuntime.execute({
				pluginId: action.pluginId,
				capabilityId: action.capabilityId,
				editor: this.editor,
				operation: action.operation,
				shapeId: action.shapeId ?? null,
				position,
				arguments: action.arguments ?? {},
			})
		}
	}
)
