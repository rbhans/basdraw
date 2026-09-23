import type { PointSnapshot } from './types'

type Listener = () => void

/**
 * Volatile live values, outside React state and tldraw history. Consumers
 * subscribe per point, so a COV for one point only wakes the shapes, labels and
 * widgets that read it. No React, DOM or station dependency.
 */
export class PointSnapshotStore {
	private values = new Map<string, PointSnapshot>()
	private versions = new Map<string, number>()
	private listeners = new Map<string, Set<Listener>>()
	private clock = 0

	static from(record: Record<string, PointSnapshot> | undefined) {
		const store = new PointSnapshotStore()
		if (record) store.replaceAll(record)
		return store
	}

	get size() { return this.values.size }

	get(point: string): PointSnapshot | undefined { return this.values.get(point) }

	/** Monotonic per-point version; changes whenever the point's value is set or removed. */
	version(point: string) { return this.versions.get(point) ?? 0 }

	pick(points: readonly string[]): Record<string, PointSnapshot> {
		const result: Record<string, PointSnapshot> = {}
		for (const point of points) {
			const value = this.values.get(point)
			if (value) result[point] = value
		}
		return result
	}

	/** Merge snapshots from a read, subscription response or COV push. Returns changed point references. */
	ingest(value: unknown): string[] {
		if (!Array.isArray(value)) return []
		const changed: string[] = []
		for (const candidate of value) {
			if (!candidate || typeof candidate !== 'object') continue
			const snapshot = candidate as PointSnapshot
			if (typeof snapshot.point !== 'string') continue
			const previous = this.values.get(snapshot.point)
			const next = { ...previous, ...snapshot }
			if (previous && shallowEqual(previous, next)) continue
			this.values.set(snapshot.point, next)
			this.versions.set(snapshot.point, ++this.clock)
			changed.push(snapshot.point)
		}
		this.notify(changed)
		return changed
	}

	/** Replace every value (fixtures and previews). */
	replaceAll(record: Record<string, PointSnapshot>) {
		const changed: string[] = []
		for (const point of this.values.keys()) {
			if (!(point in record)) { this.values.delete(point); this.versions.set(point, ++this.clock); changed.push(point) }
		}
		for (const [point, snapshot] of Object.entries(record)) {
			const previous = this.values.get(point)
			if (previous && shallowEqual(previous, snapshot)) continue
			this.values.set(point, snapshot)
			this.versions.set(point, ++this.clock)
			changed.push(point)
		}
		this.notify(changed)
	}

	clear() {
		const changed = [...this.values.keys()]
		this.values.clear()
		for (const point of changed) this.versions.set(point, ++this.clock)
		this.notify(changed)
	}

	subscribe(point: string, listener: Listener) {
		let set = this.listeners.get(point)
		if (!set) { set = new Set(); this.listeners.set(point, set) }
		set.add(listener)
		return () => {
			const current = this.listeners.get(point)
			if (!current) return
			current.delete(listener)
			if (!current.size) this.listeners.delete(point)
		}
	}

	/** Number of points with at least one subscriber (diagnostics and tests). */
	get subscribedPointCount() { return this.listeners.size }

	private notify(points: readonly string[]) {
		if (!points.length) return
		// A consumer that reads several changed points is woken once per batch.
		const pending = new Set<Listener>()
		for (const point of points) for (const listener of this.listeners.get(point) ?? []) pending.add(listener)
		for (const listener of pending) listener()
	}
}

function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>) {
	const keys = Object.keys(a)
	if (keys.length !== Object.keys(b).length) return false
	return keys.every((key) => Object.is(a[key], b[key]))
}
