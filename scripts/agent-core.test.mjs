import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
	capContinuationData,
	createPromptChainState,
	decideContinuation,
	MAX_AUTOMATIC_CONTINUATIONS,
	MAX_CHAIN_CONTINUATIONS,
} from '../client/agent/promptChainPolicy.ts'
import { getProtectingLockId, hasProtectedDescendant, partitionByLock } from '../client/agent/shapeLocks.ts'
import { applyMatrixToPoint, pagePointToParentSpace, resolveParentSpacePosition } from '../shared/format/parentSpace.ts'
import { getChangedFields, jsonEqual } from '../shared/format/jsonEqual.ts'
import { boundChatHistoryForPrompt, stripHistoryDiffsForPersistence } from '../client/parts/chatHistoryBounds.ts'
import { partitionDiffByCurrentState, reverseDiff } from '../client/components/chat-history/diffConflicts.ts'

test('an errored prompt chain never continues automatically', () => {
	const chain = createPromptChainState()
	chain.errored = true
	assert.deepEqual(decideContinuation(chain, { source: 'self', automatic: true }), { continue: false, reason: 'error' })
	assert.deepEqual(decideContinuation(chain, { source: 'self', automatic: false }), { continue: false, reason: 'error' })
	// A new user message starts a fresh chain
	assert.deepEqual(decideContinuation(chain, { source: 'user', automatic: false }), { continue: true })
	assert.equal(chain.errored, false)
})

test('automatic continuations are capped per user prompt', () => {
	const chain = createPromptChainState()
	for (let i = 0; i < MAX_AUTOMATIC_CONTINUATIONS; i++) {
		assert.equal(decideContinuation(chain, { source: 'self', automatic: true }).continue, true)
	}
	assert.deepEqual(decideContinuation(chain, { source: 'self', automatic: true }), { continue: false, reason: 'automatic-limit' })
	// Action-scheduled follow-ups (tool results) reset the consecutive counter
	assert.equal(decideContinuation(chain, { source: 'self', automatic: false }).continue, true)
	assert.equal(chain.automaticContinuations, 0)
	assert.equal(decideContinuation(chain, { source: 'self', automatic: true }).continue, true)
})

test('the total number of follow-ups in a chain is capped', () => {
	const chain = createPromptChainState()
	for (let i = 0; i < MAX_CHAIN_CONTINUATIONS; i++) {
		assert.equal(decideContinuation(chain, { source: 'self', automatic: false }).continue, true)
	}
	assert.deepEqual(decideContinuation(chain, { source: 'self', automatic: false }), { continue: false, reason: 'chain-limit' })
})

test('continuation data is bounded per item and in total', () => {
	const small = { ok: true }
	const big = { text: 'x'.repeat(500) }
	const capped = capContinuationData([small, big, big, big], { maxTotalChars: 1_000, maxItemChars: 300 })
	assert.deepEqual(capped[0], small)
	assert.equal(capped[1].truncated, true)
	assert.equal(capped[1].preview.length, 300)
	assert.ok(JSON.stringify(capped).length < 2_000)
	assert.ok(capped.some((item) => item.omitted === true))
})

test('user-locked shapes and their descendants are protected; agent-created locks are not', () => {
	const nodes = {
		'shape:frame': { id: 'shape:frame', parentId: 'page:1', isLocked: true },
		'shape:piece': { id: 'shape:piece', parentId: 'shape:frame', isLocked: false },
		'shape:free': { id: 'shape:free', parentId: 'page:1', isLocked: false },
		'shape:streaming': { id: 'shape:streaming', parentId: 'page:1', isLocked: true },
		'shape:group': { id: 'shape:group', parentId: 'page:1', isLocked: false },
		'shape:lockedChild': { id: 'shape:lockedChild', parentId: 'shape:group', isLocked: true },
	}
	const getNode = (id) => nodes[id]
	const children = (id) => Object.values(nodes).filter((n) => n.parentId === id).map((n) => n.id)
	const created = new Set(['shape:streaming'])
	assert.equal(getProtectingLockId('shape:frame', getNode, created), 'shape:frame')
	assert.equal(getProtectingLockId('shape:piece', getNode, created), 'shape:frame')
	assert.equal(getProtectingLockId('shape:free', getNode, created), null)
	assert.equal(getProtectingLockId('shape:streaming', getNode, created), null)
	assert.equal(hasProtectedDescendant('shape:group', getNode, children, created), true)
	assert.deepEqual(partitionByLock(Object.keys(nodes), getNode, created, children), {
		allowed: ['shape:free', 'shape:streaming'],
		protected: ['shape:frame', 'shape:piece', 'shape:group', 'shape:lockedChild'],
	})
})

test('page points convert back into a parent frame space', () => {
	const translate = { a: 1, b: 0, c: 0, d: 1, e: 100, f: 50 }
	assert.deepEqual(pagePointToParentSpace({ x: 130, y: 70 }, translate), { x: 30, y: 20 })
	assert.deepEqual(pagePointToParentSpace({ x: 130, y: 70 }, null), { x: 130, y: 70 })
	// A rotated parent (90deg) round-trips
	const rotated = { a: 0, b: 1, c: -1, d: 0, e: 10, f: 20 }
	const local = { x: 5, y: 7 }
	const back = pagePointToParentSpace(applyMatrixToPoint(rotated, local), rotated)
	assert.ok(Math.abs(back.x - local.x) < 1e-9 && Math.abs(back.y - local.y) < 1e-9)
	// Partial updates keep the other coordinate where it is
	assert.deepEqual(resolveParentSpacePosition({ x: 150 }, { x: 30, y: 20 }, translate), { x: 50, y: 20 })
	assert.deepEqual(resolveParentSpacePosition({}, { x: 30, y: 20 }, translate), { x: 30, y: 20 })
})

test('focused shape changes use deep equality and report only changed props', () => {
	assert.equal(jsonEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), true)
	assert.equal(jsonEqual({ a: 1 }, { a: 1, b: undefined }), true)
	assert.equal(jsonEqual({ a: 1 }, { a: 2 }), false)
	const from = { _type: 'unknown', shapeId: 's', x: 1, props: { label: 'A', value: 3 } }
	assert.equal(getChangedFields(from, structuredClone(from)), null)
	assert.deepEqual(getChangedFields(from, { ...from, x: 2, props: { label: 'A', value: 4 } }), {
		from: { x: 1, props: { value: 3 } },
		to: { x: 2, props: { value: 4 } },
	})
})

test('prompt chat history drops diffs, shortens old data and fits a total budget', () => {
	const diff = { added: { 'shape:a': { id: 'shape:a' } }, updated: {}, removed: {} }
	const history = [
		{ type: 'prompt', promptSource: 'user', agentFacingMessage: 'hi', userFacingMessage: 'hi', contextItems: [], selectedShapes: [] },
		{ type: 'action', action: { _type: 'message', text: 'ok', complete: true, time: 0 }, diff, acceptance: 'pending' },
		...Array.from({ length: 5 }, (_, i) => ({ type: 'continuation', data: [{ i, text: 'y'.repeat(5_000) }] })),
	]
	const bounded = boundChatHistoryForPrompt(history, {
		recentContinuations: 2,
		maxRecentContinuationChars: 10_000,
		maxOldContinuationChars: 100,
		maxTotalChars: 1_000_000,
	})
	assert.deepEqual(bounded[1].diff, { added: {}, updated: {}, removed: {} })
	assert.equal(history[1].diff, diff) // input untouched
	assert.equal(bounded[2].data[0].truncated, true)
	assert.equal(bounded[6].data[0].i, 4)

	const tight = boundChatHistoryForPrompt(history, {
		recentContinuations: 5,
		maxRecentContinuationChars: 10_000,
		maxOldContinuationChars: 100,
		maxTotalChars: 12_000,
	})
	assert.ok(JSON.stringify(tight.slice(1)).length <= 12_000)
	assert.match(tight[0].data[0].note, /omitted/)
	assert.equal(tight.at(-1).data[0].i, 4)
})

test('persisted chat history keeps only recent, small diffs', () => {
	const diff = { added: { 'shape:a': { id: 'shape:a' } }, updated: {}, removed: {} }
	const history = Array.from({ length: 4 }, () => ({ type: 'action', action: { _type: 'delete' }, diff, acceptance: 'pending' }))
	const stripped = stripHistoryDiffsForPersistence(history, { recentDiffs: 2, maxDiffChars: 1_000 })
	assert.deepEqual(stripped.map((item) => !!item.diffOmitted), [true, true, false, false])
	assert.equal(stripped[3].diff, diff)
})

test('reverting a diff skips records that changed since it was captured', () => {
	const before = { id: 'shape:a', x: 0 }
	const after = { id: 'shape:a', x: 10 }
	const created = { id: 'shape:b', x: 5 }
	const diff = { added: { 'shape:b': created }, updated: { 'shape:a': [before, after] }, removed: {} }
	const isEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b)

	// Unchanged canvas: the whole revert applies
	let store = { 'shape:a': after, 'shape:b': created }
	let result = partitionDiffByCurrentState(reverseDiff(diff), (id) => store[id], isEqual)
	assert.deepEqual(result.conflicts, [])
	assert.deepEqual(Object.keys(result.applicable.removed), ['shape:b'])
	assert.deepEqual(result.applicable.updated['shape:a'], [after, before])

	// The user moved shape:a afterwards: it's reported, not overwritten
	store = { 'shape:a': { id: 'shape:a', x: 99 }, 'shape:b': created }
	result = partitionDiffByCurrentState(reverseDiff(diff), (id) => store[id], isEqual)
	assert.deepEqual(result.conflicts, ['shape:a'])
	assert.deepEqual(result.applicable.updated, {})
	assert.deepEqual(Object.keys(result.applicable.removed), ['shape:b'])
})
