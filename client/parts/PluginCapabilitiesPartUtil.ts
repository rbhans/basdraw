import type { PluginCapabilitiesPart } from '../../shared/schema/PromptPartDefinitions'
import type { AgentRequest } from '../../shared/types/AgentRequest'
import { agentPluginRuntime } from '../plugins/AgentPluginRuntime'
import { PromptPartUtil, registerPromptPartUtil } from './PromptPartUtil'

const MAX_INSPECTED_PLUGIN_SHAPES = 80

export const PluginCapabilitiesPartUtil = registerPromptPartUtil(
	class PluginCapabilitiesPartUtil extends PromptPartUtil<PluginCapabilitiesPart> {
		static override type = 'pluginCapabilities' as const
		override getPart(_request: AgentRequest): PluginCapabilitiesPart {
			const viewport = this.editor.getViewportPageBounds()
			const shapes = this.editor.getCurrentPageShapes()
				.filter((shape) => {
					const bounds = this.editor.getShapePageBounds(shape)
					return bounds ? viewport.collides(bounds) : false
				})
				.slice(0, MAX_INSPECTED_PLUGIN_SHAPES)
			return {
				type: 'pluginCapabilities',
				capabilities: agentPluginRuntime.describe().map((capability) => ({
					...capability,
					operations: [...capability.operations],
					inputSchema: { ...capability.inputSchema },
				})),
				shapes: agentPluginRuntime.inspect(this.editor, shapes),
			}
		}
	}
)
