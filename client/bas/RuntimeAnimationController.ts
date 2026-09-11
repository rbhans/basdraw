/** Transient animation state. No shape records, DOM, connection, or React dependencies. */
export type RuntimeValues = Record<string, number>
export const runtimeEasing = (t: number) => t * t * (3 - 2 * t)

// A continuous effect samples a normalized cycle. Add new waveforms here.
export const runtimeCycles = {
	spin: (phase: number) => phase,
	travel: (phase: number) => runtimeEasing(phase < 0.5 ? phase * 2 : (1 - phase) * 2),
}
export type RuntimeCycle = keyof typeof runtimeCycles
type Cycle = { phase: number; seconds: number; kind: RuntimeCycle; listeners: Set<(value: number) => void> }
type Tween = { current: RuntimeValues; start: RuntimeValues; target: RuntimeValues; elapsed: number; duration: number; paint: (values: RuntimeValues) => void }

export class RuntimeAnimationController {
	private cycles = new Map<string, Cycle>()
	private tweens = new Set<Tween>()
	private enabled = true
	get subscriptionCount() { return this.tweens.size + [...this.cycles.values()].reduce((n, c) => n + c.listeners.size, 0) }
	get cycleCount() { return this.cycles.size }

	subscribeCycle(id: string, kind: RuntimeCycle, seconds: number, paint: (value: number) => void) {
		let cycle = this.cycles.get(id)
		if (!cycle) { cycle = { phase: 0, kind, seconds, listeners: new Set() }; this.cycles.set(id, cycle) }
		cycle.listeners.add(paint)
		paint(this.enabled ? runtimeCycles[cycle.kind](cycle.phase) : 0)
		return {
			update: (nextSeconds: number) => { cycle.seconds = Math.max(0.001, nextSeconds); paint(this.enabled ? runtimeCycles[cycle.kind](cycle.phase) : 0) },
			dispose: () => { cycle.listeners.delete(paint); if (!cycle.listeners.size) this.cycles.delete(id) },
		}
	}

	subscribeValues(target: RuntimeValues, paint: (values: RuntimeValues) => void, duration = 180) {
		const tween: Tween = { current: { ...target }, start: { ...target }, target: { ...target }, elapsed: duration, duration, paint }
		this.tweens.add(tween)
		paint(tween.current)
		return {
			update: (next: RuntimeValues) => {
				if (Object.keys(next).length === Object.keys(tween.target).length && Object.keys(next).every(k => next[k] === tween.target[k])) { paint(tween.current); return }
				tween.start = { ...tween.current }; tween.target = { ...next }; tween.elapsed = 0
				if (!this.enabled || duration <= 0) { tween.current = { ...next }; tween.elapsed = duration; paint(tween.current) }
			},
			dispose: () => { this.tweens.delete(tween) },
		}
	}

	tick(elapsed: number, enabled = true) {
		const changed = enabled !== this.enabled
		this.enabled = enabled
		const dt = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0
		for (const cycle of this.cycles.values()) {
			if (!enabled && !changed) continue
			if (enabled) cycle.phase = (cycle.phase + dt / (Math.max(0.001, cycle.seconds) * 1000)) % 1
			const value = enabled ? runtimeCycles[cycle.kind](cycle.phase) : 0
			for (const paint of cycle.listeners) paint(value)
		}
		for (const tween of this.tweens) {
			if (tween.elapsed >= tween.duration && !changed) continue
			tween.elapsed = enabled ? Math.min(tween.duration, tween.elapsed + dt) : tween.duration
			const progress = tween.duration <= 0 ? 1 : runtimeEasing(tween.elapsed / tween.duration)
			for (const key of Object.keys(tween.target)) {
				const start = tween.start[key] ?? tween.target[key]
				tween.current[key] = start + (tween.target[key] - start) * progress
			}
			tween.paint(tween.current)
		}
	}

	dispose() { this.cycles.clear(); this.tweens.clear() }
}
