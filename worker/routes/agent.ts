import type { IRequest } from 'itty-router'
import { DEFAULT_REASONING_EFFORT, isReasoningEffort } from '../../shared/models'
import type { Environment } from '../environment'

const defaultCodexBridgeUrl = 'http://127.0.0.1:8791'

type CodexBridgeStatus = {
	available?: boolean
	authenticated?: boolean
	authMode?: string | null
	planType?: string | null
	models?: Array<{
		id?: string
		label?: string
		isDefault?: boolean
		defaultReasoningEffort?: unknown
		supportedReasoningEfforts?: Array<{ value?: unknown; description?: unknown }>
	}>
}

export async function getAgentStatus(_request: IRequest, env: Environment) {
	const codex = await readCodexStatus(env)
	const providers = {
		codex: Boolean(codex.authenticated && codex.authMode === 'chatgpt'),
		openai: Boolean(env.OPENAI_API_KEY),
		anthropic: Boolean(env.ANTHROPIC_API_KEY),
		google: Boolean(env.GOOGLE_API_KEY),
	}
	return Response.json({
		configured: Object.values(providers).some(Boolean),
		providers,
		codex,
	})
}

export async function startChatGptLogin(request: IRequest, env: Environment) {
	const requestUrl = new URL(request.url)
	if (requestUrl.hostname !== '127.0.0.1' && requestUrl.hostname !== 'localhost') {
		return Response.json({ error: 'ChatGPT subscription login is available only from the local basdraw app.' }, { status: 403 })
	}
	try {
		const response = await fetch(`${codexBridgeUrl(env)}/login`, {
			method: 'POST',
			headers: { 'X-Basdraw-Codex': '1' },
			signal: AbortSignal.timeout(5_000),
		})
		return new Response(response.body, { status: response.status, headers: { 'Content-Type': 'application/json' } })
	} catch {
		return Response.json({ error: 'The local Codex subscription bridge is unavailable. Start basdraw with npm run dev.' }, { status: 503 })
	}
}

async function readCodexStatus(env: Environment): Promise<Required<CodexBridgeStatus>> {
	try {
		const response = await fetch(`${codexBridgeUrl(env)}/status`, {
			headers: { 'X-Basdraw-Codex': '1' },
			signal: AbortSignal.timeout(2_000),
		})
		if (!response.ok) throw new Error('Codex status failed')
		const result = await response.json() as CodexBridgeStatus
		return {
			available: Boolean(result.available),
			authenticated: Boolean(result.authenticated),
			authMode: typeof result.authMode === 'string' ? result.authMode : null,
			planType: typeof result.planType === 'string' ? result.planType : null,
			models: Array.isArray(result.models) ? result.models.flatMap((model) =>
				typeof model.id === 'string' ? [{
					id: model.id,
					label: typeof model.label === 'string' ? model.label : model.id,
					isDefault: Boolean(model.isDefault),
					defaultReasoningEffort: isReasoningEffort(model.defaultReasoningEffort)
						? model.defaultReasoningEffort
						: DEFAULT_REASONING_EFFORT,
					supportedReasoningEfforts: Array.isArray(model.supportedReasoningEfforts)
						? model.supportedReasoningEfforts.flatMap((option) =>
							isReasoningEffort(option.value) ? [{
								value: option.value,
								description: typeof option.description === 'string' ? option.description : '',
							}] : [])
						: [],
				}] : []) : [],
		}
	} catch {
		return { available: false, authenticated: false, authMode: null, planType: null, models: [] }
	}
}

function codexBridgeUrl(env: Environment) {
	return (env.CODEX_BRIDGE_URL || defaultCodexBridgeUrl).replace(/\/$/, '')
}
