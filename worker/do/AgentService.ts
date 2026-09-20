import { AnthropicProvider, AnthropicProviderOptions, createAnthropic } from '@ai-sdk/anthropic'
import {
	createGoogleGenerativeAI,
	GoogleGenerativeAIProvider,
	GoogleGenerativeAIProviderOptions,
} from '@ai-sdk/google'
import { createOpenAI, OpenAIProvider, OpenAIResponsesProviderOptions } from '@ai-sdk/openai'
import { LanguageModel, ModelMessage, streamText } from 'ai'
import {
	AgentModelDefinition,
	AgentModelName,
	AgentModelProvider,
	getAgentModelDefinition,
	isValidModelName,
} from '../../shared/models'
import { DebugPart } from '../../shared/schema/PromptPartDefinitions'
import type { KnowledgeScopePart } from '../../shared/schema/PromptPartDefinitions'
import { buildResponseSchema } from '../../shared/schema/buildResponseSchema'
import { fromStrictOutput, toStrictOutputSchema } from '../../shared/schema/strictOutput'
import { getActionSchemaForMode } from '../../shared/types/AgentAction'
import { AgentAction } from '../../shared/types/AgentAction'
import { AgentPrompt } from '../../shared/types/AgentPrompt'
import { Streaming } from '../../shared/types/Streaming'
import { Environment } from '../environment'
import { KnowledgeStore } from '../knowledge/KnowledgeStore'
import { KnowledgeService, formatKnowledgeCatalog } from '../knowledge/KnowledgeService'
import { knowledgeBundles } from '../../shared/knowledge/bundles'
import { buildMessages } from '../prompt/buildMessages'
import { buildSystemPrompt } from '../prompt/buildSystemPrompt'
import { getModelName } from '../prompt/getModelName'
import { closeAndParseJson } from './closeAndParseJson'

export class AgentService {
	openai: OpenAIProvider
	anthropic: AnthropicProvider
	google: GoogleGenerativeAIProvider
	knowledge: KnowledgeStore
	availableProviders: Record<AgentModelProvider, boolean>

	constructor(private env: Environment) {
		this.openai = createOpenAI({ apiKey: env.OPENAI_API_KEY })
		this.anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })
		this.google = createGoogleGenerativeAI({ apiKey: env.GOOGLE_API_KEY })
		this.knowledge = new KnowledgeStore(env.KNOWLEDGE_DB)
		this.availableProviders = {
			codex: true,
			openai: Boolean(env.OPENAI_API_KEY),
			anthropic: Boolean(env.ANTHROPIC_API_KEY),
			google: Boolean(env.GOOGLE_API_KEY),
		}
	}

	getModel(modelName: AgentModelName): LanguageModel {
		const modelDefinition = getAgentModelDefinition(modelName)
		const provider = modelDefinition.provider
		if (provider === 'codex') {
			throw new Error('Codex subscription models are provided by the local Codex bridge.')
		}
		if (!this.availableProviders[provider]) {
			throw new Error(`${provider} is not configured for this basdraw server.`)
		}
		return this[provider](modelDefinition.id)
	}

	async *stream(prompt: AgentPrompt): AsyncGenerator<Streaming<AgentAction>> {
		try {
			for await (const event of this.streamActions(prompt)) {
				yield event
			}
		} catch (error: any) {
			console.error('Stream error:', error)
			throw error
		}
	}

	private async *streamActions(prompt: AgentPrompt): AsyncGenerator<Streaming<AgentAction>> {
		const modelName = getModelName(prompt)
		const modelDefinition = getAgentModelDefinition(modelName)
		const isCodexSubscription = modelDefinition.provider === 'codex'
		const model = isCodexSubscription ? null : this.getModel(modelName)
		if (model && typeof model === 'string') throw new Error('Model is a string, not a LanguageModel')
		const modelInfo = model as { modelId: string; provider: string } | null
		if (modelInfo && !isValidModelName(modelInfo.modelId)) {
			throw new Error(`Model ${modelInfo.modelId} is not in AGENT_MODEL_DEFINITIONS`)
		}
		const provider = isCodexSubscription ? 'codex.subscription' : modelInfo!.provider
		const systemPrompt = buildSystemPrompt(prompt)
		const outputSchema = buildResponseSchema(prompt.mode.actionTypes, prompt.mode.modeType)

		// Build messages with provider-specific options
		const messages: ModelMessage[] = []

		// Add system prompt with Anthropic caching if applicable
		if (provider === 'anthropic.messages') {
			// Anthropic requires explicit cache breakpoints. We set one at the end of the
			// system prompt to cache all system content (which generally changes together).
			messages.push({
				role: 'system',
				content: systemPrompt,
				providerOptions: {
					anthropic: { cacheControl: { type: 'ephemeral' } },
				},
			})
		} else {
			messages.push({
				role: 'system',
				content: systemPrompt,
			})
		}

		const knowledgeMessage = await this.buildKnowledgeMessage(prompt.knowledgeScope as KnowledgeScopePart | undefined)
		if (knowledgeMessage) messages.push(knowledgeMessage)

		// Add prompt messages
		const promptMessages = buildMessages(prompt)
		messages.push(...promptMessages)

		// Check for debug flags and log if enabled
		const debugPart = prompt.debug as DebugPart | undefined
		if (debugPart) {
			if (debugPart.logSystemPrompt) {
				const promptWithoutSchema = buildSystemPrompt(prompt, { withSchema: false })
				console.log('[DEBUG] System Prompt (without schema):\n', promptWithoutSchema)
			}
			if (debugPart.logMessages) {
				console.log('[DEBUG] Messages:\n', JSON.stringify(promptMessages, null, 2))
			}
		}

		// Prefill the assistant turn to force the JSON start, where the model allows it.
		// Opus 4.7+ and Sonnet 4.6 reject last-assistant-turn prefills (400), so skip it there.
		if (!isCodexSubscription && modelDefinition.supportsPrefill) {
			messages.push({
				role: 'assistant',
				content: '{"actions": [{"_type":',
			})
		}

		try {
			const textStream: AsyncIterable<string> = isCodexSubscription
				? this.streamCodexSubscription(prompt, systemPrompt, messages, modelDefinition.id)
				: streamText({
					model: model!,
					messages,
					maxOutputTokens: 8192,
					// Opus 4.7+ removed `temperature` (and top_p/top_k); sending it returns a 400.
					...(modelDefinition.supportsTemperature ? { temperature: 0 } : {}),
					providerOptions: getProviderOptions(modelDefinition),
					onAbort() {
						console.warn('Stream actions aborted')
					},
					onError: (e) => {
						console.error('Stream text error:', e)
						throw e
					},
				}).textStream

			const canForceResponseStart =
				(provider === 'anthropic.messages' || provider === 'google.generative-ai') &&
				modelDefinition.supportsPrefill
			let buffer = canForceResponseStart ? '{"actions": [{"_type":' : ''
			let cursor = 0
			let maybeIncompleteAction: AgentAction | null = null

			let startTime = Date.now()
			for await (const text of textStream) {
				buffer += text
				const parsedObject = closeAndParseJson(buffer)
				const partialObject = isCodexSubscription ? fromStrictOutput(parsedObject, outputSchema) : parsedObject
				if (!partialObject) continue

				const actions = partialObject.actions
				if (!Array.isArray(actions)) continue
				if (actions.length === 0) continue

				// If the events list is ahead of the cursor, we know we've completed the current event
				// We can complete the event and move the cursor forward
				if (actions.length > cursor) {
					const action = actions[cursor - 1] as AgentAction
					if (action) {
						getActionSchemaForMode(action._type, prompt.mode.modeType)?.parse(action)
						yield {
							...action,
							complete: true,
							time: Date.now() - startTime,
						}
						maybeIncompleteAction = null
					}
					cursor++
				}

				// Now let's check the (potentially new) current event
				// And let's yield it in its (potentially incomplete) state
				const action = actions[cursor - 1] as AgentAction
				if (action) {
					// If we don't have an incomplete event yet, this is the start of a new one
					if (!maybeIncompleteAction) {
						startTime = Date.now()
					}

					maybeIncompleteAction = action

					// Yield the potentially incomplete event
					yield {
						...action,
						complete: false,
						time: Date.now() - startTime,
					}
				}
			}

			// If we've finished receiving events, but there's still an incomplete event, we need to complete it
			if (maybeIncompleteAction) {
				getActionSchemaForMode(maybeIncompleteAction._type, prompt.mode.modeType)?.parse(maybeIncompleteAction)
				yield {
					...maybeIncompleteAction,
					complete: true,
					time: Date.now() - startTime,
				}
			}
		} catch (error: any) {
			console.error('streamActions error:', error)
			throw error
		}
	}

	private async *streamCodexSubscription(
		prompt: AgentPrompt,
		systemPrompt: string,
		messages: ModelMessage[],
		modelId: string
	): AsyncGenerator<string> {
		const mode = prompt.mode
		if (!mode) throw new Error('A mode part is required for Codex structured output.')
		const response = await fetch(`${(this.env.CODEX_BRIDGE_URL || 'http://127.0.0.1:8791').replace(/\/$/, '')}/generate`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Basdraw-Codex': '1' },
			body: JSON.stringify({
				model: modelId,
				effort: prompt.modelName?.reasoningEffort || 'low',
				systemPrompt: systemPrompt + '\nFor strict structured output, represent unused optional fields as null and open argument maps as JSON-encoded strings, as specified in the output schema.',
				input: toCodexInput(messages.filter((message) => message.role !== 'system')),
				outputSchema: toStrictOutputSchema(buildResponseSchema(mode.actionTypes, mode.modeType)),
			}),
		})
		if (!response.ok) {
			const result = await response.json().catch(() => null) as { error?: string } | null
			throw new Error(result?.error || `Codex subscription bridge returned ${response.status}.`)
		}
		if (!response.body) throw new Error('Codex subscription bridge returned no response body.')

		const reader = response.body.getReader()
		const decoder = new TextDecoder()
		let buffer = ''
		while (true) {
			const { value, done } = await reader.read()
			buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
			const lines = buffer.split('\n')
			buffer = lines.pop() || ''
			for (const line of lines) {
				if (!line.trim()) continue
				const event = JSON.parse(line) as { delta?: string; error?: string }
				if (event.error) throw new Error(event.error)
				if (event.delta) yield event.delta
			}
			if (done) break
		}
		if (buffer.trim()) {
			const event = JSON.parse(buffer) as { delta?: string; error?: string }
			if (event.error) throw new Error(event.error)
			if (event.delta) yield event.delta
		}
	}

	private async buildKnowledgeMessage(scope: KnowledgeScopePart | undefined): Promise<ModelMessage | null> {
		try {
			const service = new KnowledgeService(this.knowledge, knowledgeBundles)
			const selection = {
				projectId: scope?.projectId,
				connectionId: scope?.connectionId,
				pluginIds: scope?.pluginIds,
				connectionIds: scope?.connectionIds,
				connectionTypes: scope?.connectionTypes,
			}
			const catalog = await service.catalog(selection)
			// Revalidate retained pages every request: disabled/deleted/out-of-scope
			// knowledge cannot survive through an in-memory content cache.
			const loaded = await Promise.all((scope?.loaded ?? []).slice(-4).map(async (page) => {
				if (!['loadSkill', 'getReference'].includes(page.operation) || typeof page.id !== 'string' || !Number.isInteger(page.offset) || page.offset < 0) return { error: 'Invalid retained knowledge selection.' }
				try { return await service.retrieve(selection, page) }
				catch { return { id: page.id, error: 'Previously loaded knowledge is no longer available. Do not rely on earlier copies.' } }
			}))
			return {
				role: 'user',
				content: [{ type: 'text', text: formatKnowledgeCatalog(catalog) + '\n[EXPLICITLY LOADED KNOWLEDGE]\n' + JSON.stringify(loaded) }],
			}
		} catch (error) {
			console.warn('Knowledge context unavailable:', error)
			return null
		}
	}
}

function toCodexInput(messages: ModelMessage[]) {
	const input: Array<{ type: 'text'; text: string } | { type: 'image'; url: string }> = []
	for (const message of messages) {
		const role = message.role.toUpperCase()
		if (typeof message.content === 'string') {
			input.push({ type: 'text', text: `[${role}]\n${message.content}` })
			continue
		}
		input.push({ type: 'text', text: `[${role}]` })
		for (const item of message.content) {
			if (item.type === 'text') input.push({ type: 'text', text: item.text })
			if (item.type === 'image') {
				const image = typeof item.image === 'string' ? item.image : item.image instanceof URL ? item.image.toString() : null
				if (image) input.push({ type: 'image', url: image })
			}
		}
	}
	return input
}

type StreamTextProviderOptions = NonNullable<Parameters<typeof streamText>[0]['providerOptions']>

/**
 * Map a model definition's reasoning preferences to AI SDK provider options.
 * Only the matching provider's options are set; the SDK ignores the rest.
 */
function getProviderOptions(definition: AgentModelDefinition): StreamTextProviderOptions {
	switch (definition.provider) {
		case 'codex':
			return {}
		case 'anthropic':
			return {
				anthropic: {
					thinking:
						definition.thinking === 'adaptive' ? { type: 'adaptive' } : { type: 'disabled' },
					...(definition.effort ? { effort: definition.effort } : {}),
				} satisfies AnthropicProviderOptions,
			}
		case 'google':
			return {
				google: {
					thinkingConfig: { thinkingLevel: definition.thinkingLevel },
				} satisfies GoogleGenerativeAIProviderOptions,
			}
		case 'openai':
			return {
				openai: {
					reasoningEffort: definition.reasoningEffort,
				} satisfies OpenAIResponsesProviderOptions,
			}
	}
}
