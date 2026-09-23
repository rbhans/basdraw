import type { JsonValue } from 'tldraw'
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
			// Plugin failures (unknown capability, unsupported operation, bad arguments) are
			// reported back to the model like connection/knowledge results instead of throwing,
			// which would toast and end the whole turn.
			try {
				const policy = this.agent.getAccessPolicy()
				if (policy.ai !== 'act' || policy.canvas !== 'write') {
					throw new Error('The current access profile does not allow canvas changes.')
				}
				let shapeId: string | null = action.shapeId ?? null
				if (shapeId) {
					const editableId = helpers.ensureShapeIdIsEditable(action.shapeId!, {
						includeDescendants: action.operation === 'delete',
					})
					if (!editableId) {
						throw new Error(`Shape "${shapeId}" does not exist or is locked by the user.`)
					}
					shapeId = editableId
				}
				const position = typeof action.x === 'number' && typeof action.y === 'number'
					? helpers.removeOffsetFromVec({ x: action.x, y: action.y })
					: null
				agentPluginRuntime.execute({
					pluginId: action.pluginId,
					capabilityId: action.capabilityId,
					editor: this.editor,
					operation: action.operation,
					shapeId,
					position,
					arguments: action.arguments ?? {},
				})
			} catch (cause) {
				const result: JsonValue = {
					kind: 'plugin-content-result',
					pluginId: action.pluginId ?? null,
					capabilityId: action.capabilityId ?? null,
					operation: action.operation ?? null,
					ok: false,
					error: cause instanceof Error ? cause.message : String(cause),
				}
				if (this.agent.requests.isGenerating()) this.agent.schedule({ data: [result] })
			}
		}
	}
)
