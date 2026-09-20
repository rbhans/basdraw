import type { JsonValue } from 'tldraw'
import type {
	AgentConnectionDescription,
	AgentConnectionToolDescription,
} from '../../shared/connections'
import type { BasdrawAccessPolicy } from '../../shared/access'

export type AgentConnectionTool = AgentConnectionToolDescription & {
	execute: (input: Record<string, JsonValue>) => Promise<unknown> | unknown
}

export type AgentConnectionAdapter = {
	id: string
	type: string
	label: string
	connected: boolean
	capabilities: readonly string[]
	tools: readonly AgentConnectionTool[]
	knowledgeScopeIds?: readonly string[]
}

/**
 * Runtime-only registry for connection adapters exposed to the canvas agent.
 *
 * Adapters own authentication and protocol details. The model only receives the
 * redacted descriptions returned by describe(), never credentials or clients.
 */
export class ConnectionRuntime {
	private adapters = new Map<string, AgentConnectionAdapter>()

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
				tools: adapter.tools.filter((tool) => access === 'write' || tool.effect === 'read').map(({ execute: _execute, ...tool }) => ({
					...tool,
					inputSchema: { ...tool.inputSchema },
				})),
			}))
			.sort((a, b) => a.label.localeCompare(b.label))
	}

	async execute(connectionId: string, toolId: string, input: Record<string, JsonValue>, options: {
		access?: BasdrawAccessPolicy['connections']
		confirmedWrite?: boolean
	} = {}) {
		const access = options.access ?? 'read'
		if (access === 'none') throw new Error('Connection tools are disabled by the current access profile.')
		const adapter = this.adapters.get(connectionId)
		if (!adapter) throw new Error(`Connection ${connectionId} is not available.`)
		if (!adapter.connected) throw new Error(`${adapter.label} is not connected.`)
		const tool = adapter.tools.find((candidate) => candidate.id === toolId)
		if (!tool) throw new Error(`Tool ${toolId} is not available on ${adapter.label}.`)
		if (tool.effect === 'write' && access !== 'write') throw new Error('The current access profile allows read-only connection tools.')
		if (tool.effect === 'write' && !options.confirmedWrite) throw new Error('Connection write tools require explicit user confirmation.')
		return tool.execute(input)
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

export const connectionRuntime = new ConnectionRuntime()

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
	}
}
