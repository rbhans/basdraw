import { createContext, type ReactNode, useContext } from 'react'
import type { CanvasDocument, HistorySeriesState, PointSnapshot } from './types'

type BasRuntimeContextValue = {
	document: CanvasDocument
	connected: boolean
	stationAlias: string | null
	historySeries: Record<string, HistorySeriesState>
	loadHistory: (widgetId: string, pointReference: string, rangeMs: number) => Promise<void>
	snapshots: Record<string, PointSnapshot>
}

const BasRuntimeContext = createContext<BasRuntimeContextValue | null>(null)

export function BasRuntimeProvider({
	children,
	value,
}: {
	children: ReactNode
	value: BasRuntimeContextValue
}) {
	return <BasRuntimeContext.Provider value={value}>{children}</BasRuntimeContext.Provider>
}

export function useBasRuntime() {
	const value = useContext(BasRuntimeContext)
	if (!value) throw new Error('useBasRuntime must be used inside BasRuntimeProvider')
	return value
}
