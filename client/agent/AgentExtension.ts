import type { BasdrawAccessPolicy } from '../../shared/access'
import type { AgentAction } from '../../shared/types/AgentAction'
import type { TldrawAgent } from './TldrawAgent'

/**
 * Why the agent's in-flight work is being abandoned.
 * - 'cancel': the user stopped the agent, or it was reset/disposed.
 * - 'interrupt': new input replaced the current request (e.g. the user sent a new message).
 */
export type AgentStopReason = 'cancel' | 'interrupt'

/**
 * A small lifecycle hook surface so app features (connections, plugins, ...) can plug into
 * the agent without editing the agent core. Every hook is optional. Extensions are passed
 * to the agent when it's created, so a feature is enabled/disabled by including or omitting
 * its extension.
 */
export interface TldrawAgentExtension {
	/** A unique id, used for debugging. */
	id: string

	/**
	 * Called whenever the agent abandons in-flight work (cancel or interrupt), after the
	 * cancellation generation was bumped. Use it to drop pending approvals, timers, etc.
	 */
	onStop?(agent: TldrawAgent, reason: AgentStopReason): void

	/** Called after the agent's access policy changed. */
	onAccessPolicyChange?(
		agent: TldrawAgent,
		policy: BasdrawAccessPolicy,
		previous: BasdrawAccessPolicy
	): void

	/**
	 * Decide whether an action type (already allowed by the mode and access policy) should be
	 * offered to the model right now.
	 */
	isActionAvailable?(agent: TldrawAgent, type: AgentAction['_type']): boolean
}

/**
 * Run a hook on every extension, isolating failures so one broken extension can't
 * prevent the others (or the agent) from stopping.
 */
export function runAgentExtensionHook(
	extensions: readonly TldrawAgentExtension[],
	run: (extension: TldrawAgentExtension) => void
) {
	for (const extension of extensions) {
		try {
			run(extension)
		} catch (error) {
			console.error(`Agent extension "${extension.id}" failed:`, error)
		}
	}
}
