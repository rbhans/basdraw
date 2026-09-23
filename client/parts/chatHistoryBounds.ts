import type { ChatHistoryActionItem, ChatHistoryItem } from '../../shared/types/ChatHistoryItem'

/**
 * Budgets for the chat history that is resent with every request.
 * Dependency-free so they can be unit tested.
 */
export interface ChatHistoryPromptBudget {
	/** Continuations (retrieved data) within this many of the most recent ones keep their data. */
	recentContinuations: number
	/** Max characters of data kept for a recent continuation. */
	maxRecentContinuationChars: number
	/** Max characters of data kept for an older continuation (a short preview). */
	maxOldContinuationChars: number
	/** Max characters of the whole serialized history; the oldest items are dropped beyond it. */
	maxTotalChars: number
}

export const DEFAULT_CHAT_HISTORY_PROMPT_BUDGET: ChatHistoryPromptBudget = {
	recentContinuations: 3,
	maxRecentContinuationChars: 40_000,
	maxOldContinuationChars: 1_000,
	maxTotalChars: 200_000,
}

function emptyDiff(): ChatHistoryActionItem['diff'] {
	return { added: {}, updated: {}, removed: {} }
}

function serializedLength(value: unknown): number {
	try {
		return JSON.stringify(value)?.length ?? 0
	} catch {
		return 0
	}
}

function boundContinuationData(data: unknown[], maxChars: number): any[] {
	let serialized: string
	try {
		serialized = JSON.stringify(data) ?? '[]'
	} catch {
		return [{ omitted: true, reason: 'The data could not be serialized.' }]
	}
	if (serialized.length <= maxChars) return data
	return [
		{
			truncated: true,
			originalCharacters: serialized.length,
			preview: serialized.slice(0, maxChars),
			note: 'Older retrieved data was shortened to keep the prompt small. Retrieve it again if you need it.',
		},
	]
}

/**
 * Bound the chat history that is sent to the model with each request:
 * - canvas diffs are removed (the model never reads them; they're only for the review UI),
 * - older continuation payloads are reduced to a short preview, recent ones are capped,
 * - if the history is still too large, the oldest items are dropped (the latest prompt is kept).
 */
export function boundChatHistoryForPrompt(
	history: readonly ChatHistoryItem[],
	budget: ChatHistoryPromptBudget = DEFAULT_CHAT_HISTORY_PROMPT_BUDGET
): ChatHistoryItem[] {
	let continuationsSeen = 0
	const bounded: ChatHistoryItem[] = []
	for (let i = history.length - 1; i >= 0; i--) {
		const item = history[i]
		switch (item.type) {
			case 'action': {
				bounded.push({ ...item, diff: emptyDiff() })
				break
			}
			case 'continuation': {
				const isRecent = continuationsSeen < budget.recentContinuations
				continuationsSeen++
				const maxChars = isRecent ? budget.maxRecentContinuationChars : budget.maxOldContinuationChars
				bounded.push({ ...item, data: boundContinuationData(item.data, maxChars) })
				break
			}
			default: {
				bounded.push(item)
			}
		}
	}
	bounded.reverse()

	// Drop the oldest items until the history fits, keeping at least the latest item.
	const sizes = bounded.map(serializedLength)
	let total = sizes.reduce((sum, size) => sum + size, 0)
	let start = 0
	while (total > budget.maxTotalChars && start < bounded.length - 1) {
		total -= sizes[start]
		start++
	}
	if (start === 0) return bounded

	const kept = bounded.slice(start)
	return [
		{
			type: 'continuation',
			data: [
				{
					note: `${start} earlier chat item(s) were omitted to keep the prompt within its size budget.`,
				},
			],
		},
		...kept,
	]
}

/**
 * Budgets for the chat history that is saved to localStorage.
 */
export interface ChatHistoryPersistenceBudget {
	/** Only the diffs of this many most recent action items are kept. */
	recentDiffs: number
	/** Diffs larger than this (serialized) are dropped. */
	maxDiffChars: number
}

export const DEFAULT_CHAT_HISTORY_PERSISTENCE_BUDGET: ChatHistoryPersistenceBudget = {
	recentDiffs: 30,
	maxDiffChars: 50_000,
}

/**
 * Prepare chat history for persistence: drop old or very large diffs so the saved state
 * stays small. Items whose diff was dropped are marked with `diffOmitted` so the UI can
 * stop offering accept/reject for them.
 */
export function stripHistoryDiffsForPersistence(
	history: readonly ChatHistoryItem[],
	budget: ChatHistoryPersistenceBudget = DEFAULT_CHAT_HISTORY_PERSISTENCE_BUDGET
): ChatHistoryItem[] {
	let actionsSeen = 0
	const result = [...history]
	for (let i = result.length - 1; i >= 0; i--) {
		const item = result[i]
		if (item.type !== 'action' || item.diffOmitted) continue
		actionsSeen++
		if (actionsSeen <= budget.recentDiffs && serializedLength(item.diff) <= budget.maxDiffChars) continue
		result[i] = { ...item, diff: emptyDiff(), diffOmitted: true }
	}
	return result
}
