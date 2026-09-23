import { connectionApprovalRuntime } from '../connections/ConnectionApprovalRuntime'
import { agentPluginRuntime } from '../plugins/AgentPluginRuntime'
import type { TldrawAgentExtension } from './AgentExtension'

/**
 * Connection writes need a human approval. When the agent stops or is interrupted, any
 * approval card it's still waiting on must go away, so a late click can't run a stale write.
 */
export const connectionApprovalsExtension: TldrawAgentExtension = {
	id: 'basdraw:connection-approvals',
	onStop(agent) {
		connectionApprovalRuntime.cancelOwner(agent.id)
	},
	onAccessPolicyChange(agent, policy) {
		if (policy.connections !== 'write') connectionApprovalRuntime.cancelOwner(agent.id)
	},
}

/**
 * Only offer the plugin content action when an enabled plugin provides canvas capabilities.
 */
export const pluginCapabilitiesExtension: TldrawAgentExtension = {
	id: 'basdraw:plugin-capabilities',
	isActionAvailable(_agent, type) {
		return type !== 'pluginContent' || agentPluginRuntime.hasCapabilities()
	},
}

/**
 * The basdraw features that hook into the agent lifecycle.
 */
export const BASDRAW_AGENT_EXTENSIONS: readonly TldrawAgentExtension[] = [
	connectionApprovalsExtension,
	pluginCapabilitiesExtension,
]
