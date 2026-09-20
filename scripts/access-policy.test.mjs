import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BASDRAW_ACCESS_PROFILES, allowsAgentAction, getAccessProfile } from '../shared/access.ts'

test('access profiles map cleanly to independent AI, canvas and connection policy axes', () => {
	assert.deepEqual(BASDRAW_ACCESS_PROFILES.map(({ id, policy }) => [id, policy.ai, policy.canvas, policy.connections]), [
		['full-control', 'act', 'write', 'write'],
		['canvas-control', 'act', 'write', 'none'],
		['analysis', 'analyze', 'read', 'read'],
		['view-only', 'off', 'read', 'read'],
	])
	assert.equal(getAccessProfile('not-real').id, 'full-control')
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
