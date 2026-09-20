export type AgentModelName = keyof typeof AGENT_MODEL_DEFINITIONS | `codex:${string}`
export type AgentModelProvider = 'codex' | 'openai' | 'anthropic' | 'google'

export type AgentReasoningEffort =
	| 'none'
	| 'minimal'
	| 'low'
	| 'medium'
	| 'high'
	| 'xhigh'
	| 'max'
	| 'ultra'

export interface CodexModelInfo {
	id: string
	label: string
	isDefault: boolean
	defaultReasoningEffort: AgentReasoningEffort
	supportedReasoningEfforts: Array<{
		value: AgentReasoningEffort
		description: string
	}>
}

export type AgentProviderAvailability = Record<AgentModelProvider, boolean>

export interface AgentStatus {
	configured: boolean
	providers: AgentProviderAvailability
	codex?: {
		available: boolean
		authenticated: boolean
		authMode: string | null
		planType: string | null
		models: CodexModelInfo[]
	}
}

export const EMPTY_AGENT_STATUS: AgentStatus = {
	configured: false,
	providers: { codex: false, openai: false, anthropic: false, google: false },
}

/** Adaptive-thinking mode passed to the Anthropic provider. */
export type AnthropicThinking = 'adaptive' | 'disabled'

/** Effort level passed to the Anthropic provider (Opus 4.6+/Sonnet 4.6; not supported on Haiku 4.5). */
export type AnthropicEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** Reasoning effort passed to the OpenAI provider. */
export type OpenAIReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

/** Thinking level passed to the Google provider (Gemini 3). Thinking cannot be fully disabled. */
export type GeminiThinkingLevel = 'minimal' | 'low' | 'medium' | 'high'

interface BaseAgentModelDefinition {
	name: AgentModelName
	id: string
	displayName?: string

	/**
	 * Whether the model accepts a prefilled assistant turn to force the JSON start.
	 * Opus 4.7+ and Sonnet 4.6 reject last-assistant-turn prefills (400).
	 */
	supportsPrefill: boolean

	/**
	 * Whether the model accepts a `temperature` sampling parameter.
	 * Opus 4.7+ removed `temperature`/`top_p`/`top_k` (sending them is a 400).
	 */
	supportsTemperature: boolean
}

export interface AnthropicModelDefinition extends BaseAgentModelDefinition {
	provider: 'anthropic'
	thinking: AnthropicThinking
	/** Effort level; omit for models that don't support it (e.g. Haiku 4.5). */
	effort?: AnthropicEffort
}

export interface GoogleModelDefinition extends BaseAgentModelDefinition {
	provider: 'google'
	/**
	 * Thinking level (Gemini 3). Thinking can't be fully disabled — `minimal` is the floor,
	 * and `gemini-3.1-pro-preview` doesn't support `minimal`, so its floor is `low`.
	 */
	thinkingLevel: GeminiThinkingLevel
}

export interface OpenAIModelDefinition extends BaseAgentModelDefinition {
	provider: 'openai'
	reasoningEffort: OpenAIReasoningEffort
}

export interface CodexModelDefinition extends BaseAgentModelDefinition {
	provider: 'codex'
}

export type AgentModelDefinition =
	| CodexModelDefinition
	| AnthropicModelDefinition
	| GoogleModelDefinition
	| OpenAIModelDefinition

export const AGENT_MODEL_DEFINITIONS = {
	'codex-subscription': {
		name: 'codex-subscription',
		id: 'default',
		provider: 'codex',
		supportsPrefill: false,
		supportsTemperature: false,
	},

	// Anthropic models
	// sonnet 4.6 is recommended
	'claude-opus-4-8': {
		name: 'claude-opus-4-8',
		id: 'claude-opus-4-8',
		provider: 'anthropic',
		supportsPrefill: false,
		supportsTemperature: false,
		thinking: 'adaptive',
		effort: 'medium',
	},

	'claude-sonnet-4-6': {
		name: 'claude-sonnet-4-6',
		id: 'claude-sonnet-4-6',
		provider: 'anthropic',
		supportsPrefill: false,
		supportsTemperature: true,
		thinking: 'adaptive',
		effort: 'low',
	},

	'claude-haiku-4-5': {
		name: 'claude-haiku-4-5',
		id: 'claude-haiku-4-5',
		provider: 'anthropic',
		supportsPrefill: true,
		supportsTemperature: true,
		thinking: 'disabled',
	},

	// Google models
	// gemini 3 flash is fastest, and quite good
	'gemini-3.5-flash': {
		name: 'gemini-3.5-flash',
		id: 'gemini-3.5-flash',
		provider: 'google',
		supportsPrefill: true,
		supportsTemperature: true,
		thinkingLevel: 'minimal',
	},

	'gemini-3.1-pro-preview': {
		name: 'gemini-3.1-pro-preview',
		id: 'gemini-3.1-pro-preview',
		provider: 'google',
		supportsPrefill: true,
		supportsTemperature: true,
		thinkingLevel: 'low', // minimal is not supported on 3.1 pro, so low is the floor
	},

	'gemini-3.1-flash-lite': {
		name: 'gemini-3.1-flash-lite',
		id: 'gemini-3.1-flash-lite',
		provider: 'google',
		supportsPrefill: true,
		supportsTemperature: true,
		thinkingLevel: 'minimal',
	},

	// OpenAI models
	'gpt-5.5': {
		name: 'gpt-5.5',
		id: 'gpt-5.5',
		provider: 'openai',
		supportsPrefill: false,
		supportsTemperature: false,
		reasoningEffort: 'low',
	},

	'gpt-5.4-mini': {
		name: 'gpt-5.4-mini',
		id: 'gpt-5.4-mini',
		provider: 'openai',
		supportsPrefill: true,
		supportsTemperature: true,
		reasoningEffort: 'none',
	},
} as const

export const DEFAULT_MODEL_NAME: AgentModelName = 'codex-subscription'

export const DEFAULT_REASONING_EFFORT: AgentReasoningEffort = 'low'

export function getAgentModelLabel(modelName: AgentModelName) {
	if (modelName === 'codex-subscription' || modelName === 'codex:default') return 'ChatGPT default'
	if (modelName.startsWith('codex:')) return modelName.slice('codex:'.length)
	return modelName
}

/**
 * Check if a string is a valid AgentModelName.
 */
export function isValidModelName(value: string | undefined): value is AgentModelName {
	return !!value && (value in AGENT_MODEL_DEFINITIONS || /^codex:[A-Za-z0-9._-]+$/.test(value))
}

export function isReasoningEffort(value: unknown): value is AgentReasoningEffort {
	return typeof value === 'string' && [
		'none',
		'minimal',
		'low',
		'medium',
		'high',
		'xhigh',
		'max',
		'ultra',
	].includes(value)
}

/**
 * Get the full information about a model from its name.
 * @param modelName - The name of the model.
 * @returns The full definition of the model.
 */
export function getAgentModelDefinition(modelName: AgentModelName): AgentModelDefinition {
	if (modelName.startsWith('codex:')) {
		return {
			name: modelName,
			id: modelName.slice('codex:'.length),
			provider: 'codex',
			supportsPrefill: false,
			supportsTemperature: false,
		}
	}
	const definition = AGENT_MODEL_DEFINITIONS[modelName as keyof typeof AGENT_MODEL_DEFINITIONS]
	if (!definition) {
		throw new Error(`Model ${modelName} not found`)
	}
	return definition
}

export function getAvailableAgentModels(status: Pick<AgentStatus, 'providers' | 'codex'>): AgentModelDefinition[] {
	const apiModels = Object.values(AGENT_MODEL_DEFINITIONS).filter(
		(model) => model.provider !== 'codex' && status.providers[model.provider]
	)
	const codexModels: AgentModelDefinition[] = status.providers.codex
		? status.codex?.models.length
			? status.codex.models.map((model) => ({
				name: `codex:${model.id}` as AgentModelName,
				id: model.id,
				displayName: model.label,
				provider: 'codex' as const,
				supportsPrefill: false,
				supportsTemperature: false,
			}))
			: [AGENT_MODEL_DEFINITIONS['codex-subscription']]
		: []
	return [...codexModels, ...apiModels]
}
