import { useCallback, useRef, useSyncExternalStore } from 'react'
import type { PointSnapshotStore } from './pointSnapshotStore'
import type { PointSnapshot } from './types'

const EMPTY: Record<string, PointSnapshot> = {}

/** Subscribe to only the listed points. The returned record is stable until one of them changes. */
export function usePointSnapshots(store: PointSnapshotStore, points: readonly string[]): Record<string, PointSnapshot> {
	const key = points.join('\n')
	const cache = useRef<{ store: PointSnapshotStore; key: string; signature: string; value: Record<string, PointSnapshot> } | null>(null)
	const current = useRef(points)
	current.current = points
	// `key` stands in for the point list, so a new array with the same points keeps the subscription.
	const subscribe = useCallback((listener: () => void) => {
		const stops = current.current.map((point) => store.subscribe(point, listener))
		return () => { for (const stop of stops) stop() }
	}, [store, key])
	const getSnapshot = () => {
		if (!points.length) return EMPTY
		const signature = points.map((point) => store.version(point)).join(',')
		const cached = cache.current
		if (cached && cached.store === store && cached.key === key && cached.signature === signature) return cached.value
		const value = store.pick(points)
		cache.current = { store, key, signature, value }
		return value
	}
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function usePointSnapshot(store: PointSnapshotStore, point: string | undefined): PointSnapshot | undefined {
	const points = useRef<string[]>([])
	if ((points.current[0] ?? undefined) !== point) points.current = point ? [point] : []
	return point ? usePointSnapshots(store, points.current)[point] : usePointSnapshots(store, points.current)['']
}
