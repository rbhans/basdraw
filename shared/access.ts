export type BasdrawAccessProfileId = 'full-control' | 'canvas-control' | 'analysis' | 'view-only'

export type BasdrawAccessPolicy = {
	profileId: BasdrawAccessProfileId
	ai: 'off' | 'analyze' | 'act'
	canvas: 'read' | 'write'
	connections: 'none' | 'read' | 'write'
}

export const BASDRAW_ACCESS_PROFILES: readonly {
	id: BasdrawAccessProfileId
	label: string
	description: string
	policy: BasdrawAccessPolicy
}[] = [
	{
		id: 'full-control',
		label: 'Full control',
		description: 'AI can edit the canvas and use connection read/write tools. Connection writes still require confirmation.',
		policy: { profileId: 'full-control', ai: 'act', canvas: 'write', connections: 'write' },
	},
	{
		id: 'canvas-control',
		label: 'Canvas control',
		description: 'AI can read and edit the canvas. No BAS connection tools are shared with the model.',
		policy: { profileId: 'canvas-control', ai: 'act', canvas: 'write', connections: 'none' },
	},
	{
		id: 'analysis',
		label: 'Analysis',
		description: 'AI can inspect the canvas and use read-only connection tools, but cannot change the canvas or BAS.',
		policy: { profileId: 'analysis', ai: 'analyze', canvas: 'read', connections: 'read' },
	},
	{
		id: 'view-only',
		label: 'View only',
		description: 'The canvas is read-only and AI is unavailable. Live connected data may still display.',
		policy: { profileId: 'view-only', ai: 'off', canvas: 'read', connections: 'read' },
	},
] as const

/**
 * Used when no valid profile is stored (first run, corrupted or renamed id).
 * Canvas control keeps the AI useful for drawing but shares no BAS connection
 * tools, so a bad stored value can never silently enable station writes.
 */
export const DEFAULT_ACCESS_PROFILE_ID: BasdrawAccessProfileId = 'canvas-control'

export function getAccessProfile(id: string | null | undefined) {
	return BASDRAW_ACCESS_PROFILES.find((profile) => profile.id === id)
		?? BASDRAW_ACCESS_PROFILES.find((profile) => profile.id === DEFAULT_ACCESS_PROFILE_ID)!
}

export type AgentActionAccess = 'analysis' | 'canvas-write' | 'connection'

export function allowsAgentAction(policy: BasdrawAccessPolicy, access: AgentActionAccess) {
	if (policy.ai === 'off') return false
	if (access === 'analysis') return true
	if (access === 'canvas-write') return policy.ai === 'act' && policy.canvas === 'write'
	return policy.connections !== 'none'
}
