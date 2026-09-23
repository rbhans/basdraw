import { createContext, type ReactNode, useContext, useLayoutEffect, useMemo, useState } from 'react'
import { indexBindingsByShape, type BindingIndex } from './bindingScope'
import { PointSnapshotStore } from './pointSnapshotStore'
import { usePointSnapshots } from './usePointSnapshots'
import type { CanvasDocument, HistorySeriesState, PointSnapshot } from './types'

export type BasRuntimeContextValue = {
	/** Active (enabled, connected, current-station) bindings only. */
	document: CanvasDocument
	/** The same bindings grouped by owning shape, rebuilt once per document change. */
	bindingsByShape: BindingIndex
	connected: boolean
	stationAlias: string | null
	historySeries: Record<string, HistorySeriesState>
	loadHistory: (widgetId: string, pointReference: string, rangeMs: number) => Promise<void>
	snapshotStore: PointSnapshotStore
}

export type BasRuntimeInput = Omit<BasRuntimeContextValue, 'bindingsByShape' | 'snapshotStore'> & {
	/** Live store (app). */
	snapshotStore?: PointSnapshotStore
	/** Static values (fixtures and previews); copied into an internal store. */
	snapshots?: Record<string, PointSnapshot>
}

const BasRuntimeContext = createContext<BasRuntimeContextValue | null>(null)

const EMPTY_DOCUMENT: CanvasDocument = { version: 2, stationAlias: null, bindings: [] }
const OFFLINE_RUNTIME: BasRuntimeContextValue = {
	document: EMPTY_DOCUMENT,
	bindingsByShape: new Map(),
	connected: false,
	stationAlias: null,
	historySeries: {},
	loadHistory: async () => {},
	snapshotStore: new PointSnapshotStore(),
}

export function BasRuntimeProvider({
	children,
	value,
}: {
	children: ReactNode
	value: BasRuntimeInput
}) {
	const [fixtureStore] = useState(() => PointSnapshotStore.from(value.snapshots))
	useLayoutEffect(() => { if (!value.snapshotStore && value.snapshots) fixtureStore.replaceAll(value.snapshots) }, [fixtureStore, value.snapshotStore, value.snapshots])
	const snapshotStore = value.snapshotStore ?? fixtureStore
	const bindingsByShape = useMemo(() => indexBindingsByShape(value.document.bindings), [value.document.bindings])
	const { document, connected, stationAlias, historySeries, loadHistory } = value
	const context = useMemo<BasRuntimeContextValue>(() => ({
		document, bindingsByShape, connected, stationAlias, historySeries, loadHistory, snapshotStore,
	}), [bindingsByShape, connected, document, historySeries, loadHistory, snapshotStore, stationAlias])
	return <BasRuntimeContext.Provider value={context}>{children}</BasRuntimeContext.Provider>
}

/**
 * Host-provided runtime. Outside a provider (exports, previews, other editors) shapes
 * render offline instead of failing.
 */
export function useBasRuntime() {
	return useContext(BasRuntimeContext) ?? OFFLINE_RUNTIME
}

/** Live values for the listed points, re-rendering only when one of them changes. */
export function useRuntimeSnapshots(points: readonly string[]) {
	return usePointSnapshots(useBasRuntime().snapshotStore, points)
}
