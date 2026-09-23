import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BASDRAW_ACCESS_PROFILES, DEFAULT_ACCESS_PROFILE_ID, allowsAgentAction, getAccessProfile } from '../shared/access.ts'
import { ACCESS_PROFILE_STORAGE_KEY, readStoredAccessProfileId, selectAccessProfile } from '../client/access/accessProfileStorage.ts'

test('access profiles map cleanly to independent AI, canvas and connection policy axes', () => {
	assert.deepEqual(BASDRAW_ACCESS_PROFILES.map(({ id, policy }) => [id, policy.ai, policy.canvas, policy.connections]), [
		['full-control', 'act', 'write', 'write'],
		['canvas-control', 'act', 'write', 'none'],
		['analysis', 'analyze', 'read', 'read'],
		['view-only', 'off', 'read', 'read'],
	])
})

test('unknown, corrupted or missing stored profiles default to canvas control without station writes', () => {
	assert.equal(DEFAULT_ACCESS_PROFILE_ID, 'canvas-control')
	for (const stored of ['not-real', '', null, undefined, '{"id":"full-control"}']) {
		const profile = getAccessProfile(stored)
		assert.equal(profile.id, 'canvas-control')
		assert.equal(profile.policy.connections, 'none')
	}
	assert.equal(readStoredAccessProfileId({ getItem: () => 'garbage' }), 'canvas-control')
	assert.equal(readStoredAccessProfileId({ getItem: () => { throw new Error('SecurityError') } }), 'canvas-control')
	assert.equal(readStoredAccessProfileId(undefined), 'canvas-control')
	assert.equal(readStoredAccessProfileId({ getItem: (key) => key === ACCESS_PROFILE_STORAGE_KEY ? 'analysis' : null }), 'analysis')
})

test('a storage failure never blocks switching profiles', () => {
	const applied = []
	const failing = { setItem: () => { throw new Error('QuotaExceededError') } }
	assert.equal(selectAccessProfile('view-only', (id) => applied.push(id), failing), 'view-only')
	assert.deepEqual(applied, ['view-only'])
	const stored = new Map()
	selectAccessProfile('analysis', (id) => applied.push(id), { setItem: (key, value) => stored.set(key, value) })
	assert.equal(stored.get(ACCESS_PROFILE_STORAGE_KEY), 'analysis')
})

test('action access fails closed outside the matching policy capability', () => {
	const full = getAccessProfile('full-control').policy
	const canvas = getAccessProfile('canvas-control').policy
	const analysis = getAccessProfile('analysis').policy
	const view = getAccessProfile('view-only').policy
	assert.equal(allowsAgentAction(full, 'canvas-write'), true)
	assert.equal(allowsAgentAction(canvas, 'connection'), false)
	assert.equal(allowsAgentAction(analysis, 'analysis'), true)
	assert.equal(allowsAgentAction(analysis, 'canvas-write'), false)
	assert.equal(allowsAgentAction(view, 'analysis'), false)
})
