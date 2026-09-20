import type { Editor, JsonValue, TLShape } from 'tldraw'
import type {
	BasdrawAgentCanvasCapability,
	BasdrawAgentCanvasOperation,
	BasdrawPlugin,
} from './types'

export type AgentCanvasCapabilityDescription = {
	pluginId: string
	capabilityId: string
	title: string
	description: string
	operations: readonly BasdrawAgentCanvasOperation[]
	inputSchema: Readonly<Record<string, string>>
}

type InstalledCapability = AgentCanvasCapabilityDescription & {
	capability: BasdrawAgentCanvasCapability
}

/**
 * Runtime bridge between enabled plugins and the generic pluginContent action.
 * Plugins own validation and execution; the model receives descriptions only.
 */
export class AgentPluginRuntime {
	private capabilities = new Map<string, InstalledCapability>()

	setPlugins(plugins: readonly BasdrawPlugin[]) {
		const next = new Map<string, InstalledCapability>()
		for (const plugin of plugins) {
			for (const capability of plugin.agent?.canvasCapabilities ?? []) {
				const key = capabilityKey(plugin.id, capability.id)
				if (next.has(key)) throw new Error(`Duplicate agent canvas capability: ${key}`)
				next.set(key, {
					pluginId: plugin.id,
					capabilityId: capability.id,
					title: capability.title,
					description: capability.description,
					operations: [...capability.operations],
					inputSchema: { ...capability.inputSchema },
					capability,
				})
			}
		}
		this.capabilities = next
	}

	describe(): AgentCanvasCapabilityDescription[] {
		return [...this.capabilities.values()].map(({ capability: _capability, ...description }) => description)
	}

	hasCapabilities() { return this.capabilities.size > 0 }

	inspect(editor: Editor, shapes: readonly TLShape[]) {
		const result: { shapeId: string; shapeType: string; contributions: Record<string, JsonValue> }[] = []
		for (const shape of shapes) {
			const contributions: Record<string, JsonValue> = {}
			for (const installed of this.capabilities.values()) {
				const value = installed.capability.inspect?.(editor, shape)
				if (value !== undefined && value !== null) {
					contributions[`${installed.pluginId}:${installed.capabilityId}`] = value
				}
			}
			if (Object.keys(contributions).length) {
				result.push({ shapeId: shape.id.slice(6), shapeType: shape.type, contributions })
			}
		}
		return result
	}

	execute(input: {
		pluginId: string
		capabilityId: string
		editor: Editor
		operation: BasdrawAgentCanvasOperation
		shapeId: string | null
		position: { x: number; y: number } | null
		arguments: Record<string, JsonValue>
	}) {
		if (input.editor.getIsReadonly()) throw new Error('The current access profile makes this drawing read-only.')
		const installed = this.capabilities.get(capabilityKey(input.pluginId, input.capabilityId))
		if (!installed) throw new Error(`Canvas capability ${input.pluginId}:${input.capabilityId} is not enabled.`)
		if (!installed.operations.includes(input.operation)) {
			throw new Error(`${installed.title} does not support ${input.operation}.`)
		}
		return installed.capability.execute(input)
	}

	clear() { this.capabilities.clear() }
}

export const agentPluginRuntime = new AgentPluginRuntime()

function capabilityKey(pluginId: string, capabilityId: string) {
	return `${pluginId}:${capabilityId}`
}
