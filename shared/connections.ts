import type { JsonValue } from 'tldraw'

export type AgentConnectionToolEffect = 'read' | 'write'

export type AgentConnectionToolDescription = {
	id: string
	description: string
	capability?: string
	effect: AgentConnectionToolEffect
	inputSchema: Record<string, string>
}

export type AgentConnectionDescription = {
	id: string
	type: string
	label: string
	connected: boolean
	capabilities: string[]
	tools: AgentConnectionToolDescription[]
	/** Stable instance IDs for connection-specific knowledge, never credentials. */
	knowledgeScopeIds?: string[]
}

export type AgentConnectionToolResult = {
	kind: 'connection-tool-result'
	connectionId: string
	toolId: string
	ok: boolean
	data?: JsonValue
	error?: string
}
