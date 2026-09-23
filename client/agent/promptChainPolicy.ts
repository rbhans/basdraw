/**
 * Rules for chaining automatic follow-up requests after a user prompt.
 * Dependency-free so they can be unit tested.
 */

/** Max consecutive follow-ups that the mode schedules on its own (e.g. "continue your todos"). */
export const MAX_AUTOMATIC_CONTINUATIONS = 8

/** Max follow-ups of any kind (tool results, mode nudges, ...) for one user prompt. */
export const MAX_CHAIN_CONTINUATIONS = 24

/** Max characters of retrieved data carried into one follow-up request. */
export const MAX_CONTINUATION_DATA_CHARS = 120_000

/** Max characters of any single retrieved data item. */
export const MAX_CONTINUATION_ITEM_CHARS = 40_000

/**
 * The state of one prompt chain: a user prompt plus the follow-ups the agent scheduled for itself.
 */
export interface PromptChainState {
	/** Whether a request in this chain failed (e.g. 401/429/context length). */
	errored: boolean
	/** Consecutive follow-ups scheduled by the mode's onPromptEnd (todo/lint nudges). */
	automaticContinuations: number
	/** Follow-ups of any kind scheduled in this chain. */
	totalContinuations: number
}

export function createPromptChainState(): PromptChainState {
	return { errored: false, automaticContinuations: 0, totalContinuations: 0 }
}

export type ContinuationDecision =
	| { continue: true }
	| { continue: false; reason: 'error' | 'automatic-limit' | 'chain-limit' }

/**
 * Decide whether the chain may continue with a scheduled follow-up request, and record it.
 *
 * @param chain - The chain state (mutated when the follow-up is allowed).
 * @param followUp.source - Where the follow-up came from; a 'user' follow-up starts a new chain.
 * @param followUp.automatic - Whether the mode scheduled it on its own (rather than an action
 * scheduling retrieved data or a new instruction).
 */
export function decideContinuation(
	chain: PromptChainState,
	followUp: { source: 'user' | 'self' | 'other-agent'; automatic: boolean },
	limits = { automatic: MAX_AUTOMATIC_CONTINUATIONS, total: MAX_CHAIN_CONTINUATIONS }
): ContinuationDecision {
	if (followUp.source === 'user') {
		// The user explicitly asked for more: that's a fresh chain.
		Object.assign(chain, createPromptChainState())
		return { continue: true }
	}
	if (chain.errored) return { continue: false, reason: 'error' }
	if (followUp.automatic && chain.automaticContinuations >= limits.automatic) {
		return { continue: false, reason: 'automatic-limit' }
	}
	if (chain.totalContinuations >= limits.total) return { continue: false, reason: 'chain-limit' }
	chain.totalContinuations++
	chain.automaticContinuations = followUp.automatic ? chain.automaticContinuations + 1 : 0
	return { continue: true }
}

function serialize(value: unknown): string | undefined {
	try {
		return JSON.stringify(value)
	} catch {
		return undefined
	}
}

/**
 * Bound the data carried into a follow-up request. Oversized items are replaced with a
 * truncated preview, and once the total budget is used up, remaining items are replaced
 * with a short note so the model knows something was left out.
 */
export function capContinuationData<T>(
	items: readonly T[],
	{
		maxTotalChars = MAX_CONTINUATION_DATA_CHARS,
		maxItemChars = MAX_CONTINUATION_ITEM_CHARS,
	}: { maxTotalChars?: number; maxItemChars?: number } = {}
): (T | { truncated: true; originalCharacters: number; preview: string } | { omitted: true; originalCharacters: number; reason: string })[] {
	let used = 0
	return items.map((item) => {
		const serialized = serialize(item)
		if (serialized === undefined) {
			return { omitted: true as const, originalCharacters: 0, reason: 'The data could not be serialized.' }
		}
		const remaining = Math.max(0, maxTotalChars - used)
		if (serialized.length <= Math.min(maxItemChars, remaining)) {
			used += serialized.length
			return item
		}
		const previewLength = Math.min(maxItemChars, remaining)
		if (previewLength < 200) {
			used += 100
			return {
				omitted: true as const,
				originalCharacters: serialized.length,
				reason: 'The data budget for this request was used up. Request less data at a time.',
			}
		}
		used += previewLength + 100
		return {
			truncated: true as const,
			originalCharacters: serialized.length,
			preview: serialized.slice(0, previewLength),
		}
	})
}
