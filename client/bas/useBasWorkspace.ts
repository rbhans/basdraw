import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { Editor, RecordsDiff, TLRecord, TLShape } from 'tldraw'
import { bindingDocumentChanged, dispatchShapeBindingAction, migrateLegacyBindings, readBindingDocument, sameBindingDocument } from './shapeBindings'
import { BaskstreamClient } from './BaskstreamClient'
import { BaskstreamSession, asRecord, historySeriesKey, type ConnectionStatus } from './baskstreamSession'
import {
	isPointNode,
	type BasDocumentAction,
	type BindingValueMapping,
	type BindingOptions,
	type ConnectionInput,
	type PointSnapshot,
	type RuntimeProperty,
	type StationNode,
} from './types'
import {
	loadCanvasDocument,
	loadConnectionProfiles,
	removeConnectionProfile,
	saveConnectionProfile,
} from './storage'

export type { ConnectionStatus }
export { historySeriesKey }

/**
 * Thin React adapter: the canvas binding projection and persistence live here; protocol,
 * subscriptions and live values live in BaskstreamSession and its snapshot store.
 * Live value updates do not re-render this hook's owner.
 */
export function useBasWorkspace(editor: Editor | null, widgetPointReferences: string[] = [], pageShapeIds: string[] = [], connectionEnabled = true) {
	const [session] = useState(() => new BaskstreamSession(() => new BaskstreamClient()))
	const state = useSyncExternalStore(session.subscribe, session.getState, session.getState)
	const [document, setDocument] = useState(loadCanvasDocument)
	const [profiles, setProfiles] = useState(loadConnectionProfiles)
	const [selectedPoint, setSelectedPointState] = useState<StationNode | null>(null)
	const [notice, setNotice] = useState<string | null>(null)

	useEffect(() => {
		if (!editor) return
		migrateLegacyBindings(editor, loadCanvasDocument())
		const sync = () => {
			const next = readBindingDocument(editor)
			setDocument((current) => sameBindingDocument(current, next) ? current : next)
		}
		const pruneHistory = () => session.pruneHistory(trendHistoryKeys(editor.store.allRecords()))
		sync()
		// Only binding-relevant changes rebuild the projection; drag frames do not.
		return editor.store.listen(({ changes }) => {
			if (bindingDocumentChanged(changes)) sync()
			if (touchesTrend(changes)) pruneHistory()
		}, { scope: 'document' })
	}, [editor, session])

	const dispatchDocument = useCallback((action: BasDocumentAction) => {
		return editor ? dispatchShapeBindingAction(editor, action) : 'The canvas is not ready.'
	}, [editor])

	const disconnect = useCallback(() => {
		session.disconnect()
		setSelectedPointState(null)
	}, [session])

	const connect = useCallback(async (input: ConnectionInput) => {
		if (!connectionEnabled) throw new Error('The Niagara via baskStream add-on is disabled.')
		setSelectedPointState(null)
		setNotice(null)
		const { capabilities, profile } = await session.connect(input)
		if (input.remember) {
			// Storage is a convenience; a full or blocked store never tears down a working connection.
			if (!saveConnectionProfile(profile)) setNotice('Connected, but this endpoint could not be remembered because browser storage is full or blocked.')
			setProfiles(loadConnectionProfiles())
		}
		const aliasError = dispatchDocument({ type: 'set_station_alias', stationAlias: profile.alias })
		if (aliasError && aliasError !== 'This drawing is read-only.') setNotice(aliasError)
		return capabilities
	}, [connectionEnabled, dispatchDocument, session])

	/** Test credentials without saving a profile, writing the canvas alias or replacing the live session. */
	const testConnection = useCallback((input: ConnectionInput) => {
		if (!connectionEnabled) return Promise.reject(new Error('The Niagara via baskStream add-on is disabled.'))
		return session.testConnection(input)
	}, [connectionEnabled, session])

	useEffect(() => {
		if (!connectionEnabled) disconnect()
	}, [connectionEnabled, disconnect])

	const removeProfile = useCallback((alias: string) => {
		if (!removeConnectionProfile(alias)) setNotice('The saved endpoint could not be removed because browser storage is blocked.')
		setProfiles(loadConnectionProfiles())
	}, [])

	const request = useCallback((op: string, fields: Record<string, unknown> = {}, timeoutMs?: number) => session.request(op, fields, timeoutMs), [session])
	const requestForSession = useCallback((expectedSession: string, op: string, fields: Record<string, unknown>) => session.requestForSession(expectedSession, op, fields), [session])

	const browse = useCallback(async (ord: string) => {
		const response = await request('browse', { base: ord, depth: 1, metadata: 'full' })
		const node = response.node as StationNode | undefined
		return node?.children || []
	}, [request])

	const capabilities = state.capabilities
	const search = useCallback(async (query: string, base = 'slot:/') => {
		const response = await request('search', {
			base,
			query,
			depth: Math.min(capabilities?.limits ? 32 : 16, 32),
			features: ['point'],
			operations: ['read'],
			metadata: 'none',
			limit: 100,
			maxVisited: 50_000,
			timeoutMillis: 5_000,
		})
		const result = asRecord(response.result)
		return Array.isArray(result.nodes) ? (result.nodes as StationNode[]).filter(isPointNode) : []
	}, [capabilities?.limits, request])

	const setSelectedPoint = useCallback(async (node: StationNode | null) => {
		const client = session.currentClient
		setSelectedPointState(node)
		if (!node) return
		try {
			const response = await request('read', {
				points: [node.slotPath || node.ord],
				fields: ['value', 'displayValue', 'status', 'timestamp', 'type'],
			})
			if (session.isCurrent(client)) session.snapshots.ingest(response.points)
		} catch (cause) {
			if (session.isCurrent(client)) session.reportError(cause instanceof Error ? cause.message : String(cause))
		}
	}, [request, session])

	const readPoints = useCallback(async (pointReferences: string[]) => {
		const client = session.currentClient
		const uniquePoints = [...new Set(pointReferences.map((point) => point.trim()).filter(Boolean))]
		if (uniquePoints.length === 0) return []
		if (uniquePoints.length > 100) throw new Error('Read requests are limited to 100 points at a time.')
		const response = await request('read', {
			points: uniquePoints,
			fields: ['value', 'displayValue', 'status', 'timestamp', 'type'],
		})
		if (!session.isCurrent(client)) throw new Error('The station connection changed during the read.')
		session.snapshots.ingest(response.points)
		return Array.isArray(response.points) ? response.points as PointSnapshot[] : []
	}, [request, session])

	const readPoint = useCallback(async (node: StationNode) => {
		const points = await readPoints([node.slotPath || node.ord])
		return points[0]
	}, [readPoints])

	const connectedProfile = state.connectedProfile
	const createBinding = useCallback((shapeId: string, runtimeProperty: RuntimeProperty, mapping: BindingValueMapping, options?: BindingOptions, point?: StationNode, name?: string) => {
		const source = point || selectedPoint
		if (!connectedProfile || !source) return 'Choose a connected point first.'
		const pointReference = source.slotPath || source.ord
		return dispatchDocument({
			type: 'create_binding',
			binding: {
				id: crypto.randomUUID(),
				name,
				shapeId,
				stationAlias: connectedProfile.alias,
				pointReference,
				pointLabel: source.display || source.name || pointReference,
				runtimeProperty,
				mapping,
				options,
			},
		})
	}, [connectedProfile, dispatchDocument, selectedPoint])

	const updateBinding = useCallback((bindingId: string, runtimeProperty: RuntimeProperty, mapping: BindingValueMapping, options?: BindingOptions, point?: StationNode | null, name?: string) => {
		const binding = document.bindings.find((candidate) => candidate.id === bindingId)
		if (!binding) return 'The behavior no longer exists.'
		const pointReference = point ? point.slotPath || point.ord : binding.pointReference
		return dispatchDocument({
			type: 'update_binding',
			bindingId,
			patch: {
				name: name ?? binding.name,
				stationAlias: point && connectedProfile ? connectedProfile.alias : binding.stationAlias,
				pointReference,
				pointLabel: point ? point.display || point.name || pointReference : binding.pointLabel,
				runtimeProperty,
				mapping,
				options,
			},
		})
	}, [connectedProfile, dispatchDocument, document.bindings])

	const removeBinding = useCallback((bindingId: string) => {
		return dispatchDocument({ type: 'remove_binding', bindingId })
	}, [dispatchDocument])

	const setBindingEnabled = useCallback((bindingId: string, enabled: boolean) => {
		return dispatchDocument({ type: 'update_binding', bindingId, patch: { enabled } })
	}, [dispatchDocument])

	const loadHistory = useCallback((widgetId: string, pointReference: string, rangeMs: number) => session.loadHistory(widgetId, pointReference, rangeMs), [session])

	const activePoints = useMemo(() => {
		const pageShapes = new Set(pageShapeIds)
		return Array.from(new Set([
			...document.bindings
				.filter((binding) => binding.stationAlias === connectedProfile?.alias && pageShapes.has(binding.shapeId))
				.map((binding) => binding.pointReference),
			...widgetPointReferences,
		])).sort()
	}, [connectedProfile?.alias, document.bindings, widgetPointReferences, pageShapeIds])

	useEffect(() => { session.setActivePoints(activePoints) }, [activePoints, session])

	useEffect(() => () => session.disconnect(), [session])

	const reconnectProfile = state.status === 'error' ? state.lastProfile : null

	return useMemo(() => ({
		activePoints,
		browse,
		capabilities,
		connect,
		connectedProfile,
		createBinding,
		disconnect,
		document,
		error: state.error,
		health: state.health,
		historySeries: state.historySeries,
		loadHistory,
		notice,
		profiles,
		reconnectProfile,
		removeBinding,
		readPoint,
		readPoints,
		request,
		requestForSession,
		sessionId: state.sessionId,
		setBindingEnabled,
		removeProfile,
		search,
		selectedPoint,
		setSelectedPoint,
		/** Live values; subscribe per point with usePointSnapshot(s). */
		snapshotStore: session.snapshots,
		status: state.status,
		subscriptionError: state.subscriptionError,
		subscriptionHealth: state.subscriptionHealth,
		testConnection,
		updateBinding,
	}), [activePoints, browse, capabilities, connect, connectedProfile, createBinding, disconnect, document, loadHistory, notice, profiles, readPoint, readPoints, reconnectProfile, removeBinding, removeProfile, request, requestForSession, search, selectedPoint, session, setBindingEnabled, setSelectedPoint, state.error, state.health, state.historySeries, state.sessionId, state.status, state.subscriptionError, state.subscriptionHealth, testConnection, updateBinding])
}

function touchesTrend(changes: RecordsDiff<TLRecord>) {
	const isTrend = (record: TLRecord): record is TLShape => record.typeName === 'shape' && record.type === 'bas-trend'
	if (Object.values(changes.added).some(isTrend) || Object.values(changes.removed).some(isTrend)) return true
	return Object.values(changes.updated).some(([from, to]) => isTrend(from) && isTrend(to) && (from.props as { series?: unknown }).series !== (to.props as { series?: unknown }).series)
}

/** History cache keys for every trend series that still exists anywhere in the document. */
function trendHistoryKeys(records: readonly { typeName: string }[]) {
	const keys = new Set<string>()
	for (const record of records) {
		if (record.typeName !== 'shape') continue
		const shape = record as TLShape
		if (shape.type !== 'bas-trend') continue
		const series = (shape.props as { series?: Array<{ pointReference?: unknown }> }).series ?? []
		for (const item of series) if (typeof item.pointReference === 'string') keys.add(historySeriesKey(shape.id, item.pointReference))
	}
	return keys
}

export type BasWorkspace = ReturnType<typeof useBasWorkspace>
