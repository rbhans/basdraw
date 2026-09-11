import test from 'node:test'
import assert from 'node:assert/strict'
import { RuntimeAnimationController } from '../client/bas/RuntimeAnimationController.ts'

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`)

test('one binding shares phase across shapes, overlays, and newly attached consumers', () => {
	const runtime = new RuntimeAnimationController()
	let a, b
	const first = runtime.subscribeCycle('fan', 'spin', 2, v => a = v)
	runtime.tick(500)
	const second = runtime.subscribeCycle('fan', 'spin', 2, v => b = v)
	close(a, 0.25); close(b, 0.25)
	assert.equal(runtime.cycleCount, 1)
	runtime.tick(500); close(a, 0.5); close(b, 0.5)
	first.dispose(); runtime.tick(500); close(b, 0.75)
	second.dispose(); assert.equal(runtime.subscriptionCount, 0); assert.equal(runtime.cycleCount, 0)
})

test('changing speed preserves phase; separate bindings retain independent timing', () => {
	const runtime = new RuntimeAnimationController()
	let a, b
	const first = runtime.subscribeCycle('a', 'spin', 2, v => a = v)
	runtime.subscribeCycle('b', 'spin', 4, v => b = v)
	runtime.tick(500); first.update(1); close(a, 0.25)
	runtime.tick(250); close(a, 0.5); close(b, 0.1875)
})

test('stopping and restarting a command starts at its resting position', () => {
	const runtime = new RuntimeAnimationController()
	const first = runtime.subscribeCycle('fan', 'spin', 2, () => {})
	runtime.tick(700); first.dispose()
	let phase
	runtime.subscribeCycle('fan', 'spin', 2, v => phase = v)
	assert.equal(phase, 0)
})

test('travel returns to origin and reaches the destination halfway through', () => {
	const runtime = new RuntimeAnimationController()
	let phase
	runtime.subscribeCycle('move', 'travel', 2, v => phase = v)
	runtime.tick(1000); close(phase, 1)
	runtime.tick(1000); close(phase, 0)
})

test('numeric updates retarget from the currently displayed value without a jump', () => {
	const runtime = new RuntimeAnimationController()
	let value
	const target = runtime.subscribeValues({ level: 0 }, values => value = values.level)
	target.update({ level: 100 }); runtime.tick(90); close(value, 50)
	target.update({ level: 0 }); close(value, 50)
	runtime.tick(90); close(value, 25)
	runtime.tick(90); close(value, 0)
})

test('first reading is immediate and multiple numeric channels compose', () => {
	const runtime = new RuntimeAnimationController()
	let value
	const target = runtime.subscribeValues({ x: 100, rotation: 45, opacity: 1 }, values => value = { ...values })
	assert.deepEqual(value, { x: 100, rotation: 45, opacity: 1 })
	target.update({ x: 200, rotation: 90, opacity: 0.5 }); runtime.tick(180)
	assert.deepEqual(value, { x: 200, rotation: 90, opacity: 0.5 })
	target.dispose(); assert.equal(runtime.subscriptionCount, 0)
})

test('reduced motion stops cycles and immediately displays numeric targets', () => {
	const runtime = new RuntimeAnimationController()
	let phase, value
	runtime.subscribeCycle('fan', 'spin', 2, v => phase = v)
	const target = runtime.subscribeValues({ x: 0 }, v => value = v.x)
	target.update({ x: 100 }); runtime.tick(90, false)
	assert.equal(phase, 0); assert.equal(value, 100)
	target.update({ x: 200 }); assert.equal(value, 200)
	runtime.tick(500, true); close(phase, 0.25)
})

test('completed numeric targets do not repaint on idle ticks', () => {
	const runtime = new RuntimeAnimationController()
	let paints = 0
	const target = runtime.subscribeValues({ x: 0 }, () => paints++)
	target.update({ x: 100 }); runtime.tick(180)
	const count = paints
	runtime.tick(1000); assert.equal(paints, count)
})

test('time is independent of frame rate and invalid elapsed time is ignored', () => {
	const a = new RuntimeAnimationController(), b = new RuntimeAnimationController()
	let first, second
	a.subscribeCycle('a', 'spin', 2, v => first = v)
	b.subscribeCycle('a', 'spin', 2, v => second = v)
	for (let i = 0; i < 60; i++) a.tick(1000 / 60)
	b.tick(1000); close(first, second)
	b.tick(NaN); b.tick(-200); close(first, second)
})

test('disposing the controller releases all subscriptions', () => {
	const runtime = new RuntimeAnimationController()
	runtime.subscribeCycle('fan', 'spin', 2, () => {})
	runtime.subscribeValues({ x: 0 }, () => {})
	runtime.dispose(); assert.equal(runtime.subscriptionCount, 0); assert.equal(runtime.cycleCount, 0)
})
