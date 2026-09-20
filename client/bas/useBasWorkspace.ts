import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from 'tldraw'
import { dispatchShapeBindingAction, migrateLegacyBindings, readBindingDocument } from './shapeBindings'
import { BaskstreamClient } from './BaskstreamClient'
import {
	isPointNode,
	type BasDocumentAction,
	type BindingValueMapping,
	type BindingOptions,
	type Capabilities,
	type ConnectionInput,
	type ConnectionProfile,
	type HistoryRecord,
	type HistorySeriesState,
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

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export function useBasWorkspace(editor: Editor | null, widgetPointReferences: string[] = [], pageShapeIds: string[] = [], connectionEnabled = true) {
	const [document, setDocument] = useState(loadCanvasDocument)
	const [profiles, setProfiles] = useState(loadConnectionProfiles)
	const [status, setStatus] = useState<ConnectionStatus>('disconnected')
	const [error, setError] = useState<string | null>(null)
	const [health, setHealth] = useState<Record<string, unknown> | null>(null)
	const [capabilities, setCapabilities] = useState<Capabilities | null>(null)
	const [connectedProfile, setConnectedProfile] = useState<ConnectionProfile | null>(null)
	const [snapshots, setSnapshots] = useState<Record<string, PointSnapshot>>({})
	const [historySeries, setHistorySeries] = useState<Record<string, HistorySeriesState>>({})
	const [selectedPoint, setSelectedPointState] = useState<StationNode | null>(null)
	const clientRef = useRef<BaskstreamClient | null>(null)
	const directSubscriptions = useRef<Set<string>>(new Set())
	const historyRequests = useRef(new Map<string, symbol>())

	useEffect(() => {
		if (!editor) return
		migrateLegacyBindings(editor, loadCanvasDocument())
		const sync = () => {
			const next = readBindingDocument(editor)
			setDocument((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next)
		}
		sync()
		return editor.store.listen(sync, { scope: 'document' })
	}, [editor])

	const dispatchDocument = useCallback((action: BasDocumentAction) => {
		return editor ? dispatchShapeBindingAction(editor, action) : 'The canvas is not ready.'
	}, [editor])

	const ingestSnapshots = useCallback((value: unknown) => {
		if (!Array.isArray(value)) return
		setSnapshots((current) => {
			const next = { ...current }
			for (const candidate of value) {
				if (!candidate || typeof candidate !== 'object') continue
				const snapshot = candidate as PointSnapshot
				if (typeof snapshot.point === 'string') next[snapshot.point] = { ...next[snapshot.point], ...snapshot }
			}
			return next
		})
	}, [])

	const disconnect = useCallback(() => {
		const client = clientRef.current
		clientRef.current = null
		if (client && capabilities?.subscriptions?.viewGroups) {
			void client.request('release_subscriptions', { group: 'canvas:active' }, 3_000).catch(() => undefined)
		}
		client?.close()
		directSubscriptions.current.clear()
		historyRequests.current.clear()
		setConnectedProfile(null)
		setCapabilities(null)
		setHealth(null)
		setSnapshots({})
		setHistorySeries({})
		setSelectedPointState(null)
		setStatus('disconnected')
		setError(null)
	}, [capabilities?.subscriptions?.viewGroups])

	const connect = useCallback(async (input: ConnectionInput) => {
		if (!connectionEnabled) throw new Error('The Niagara via baskStream add-on is disabled.')
		disconnect()
		setStatus('connecting')
		setError(null)
		const client = new BaskstreamClient()
		clientRef.current = client
		client.onPush((message) => {
			if (clientRef.current !== client) return
			if (message.op === 'cov') ingestSnapshots(message.points)
			if (message.op === 'subscriptions_revoked' && Array.isArray(message.points)) {
				setError(`Niagara revoked ${message.points.length} active point subscription${message.points.length === 1 ? '' : 's'}.`)
			}
			if (message.op === 'session_revoked' || message.op === 'station_closed') {
				clientRef.current = null
				client.close()
				directSubscriptions.current.clear()
				setSnapshots({})
				setHistorySeries({})
				setSelectedPointState(null)
				setCapabilities(null)
				setStatus('disconnected')
				setConnectedProfile(null)
			}
		})
		try {
			const connected = await client.connect(input)
			const capabilityResponse = await client.request('capabilities')
			if (clientRef.current !== client) throw new Error('Connection was cancelled.')
			const nextCapabilities = asCapabilities(capabilityResponse.capabilities)
			const profile: ConnectionProfile = {
				alias: input.alias,
				name: input.name,
				stationUrl: input.stationUrl,
				username: input.username,
				tlsMode: input.tlsMode,
			}
			if (input.remember) {
				saveConnectionProfile(profile)
				setProfiles(loadConnectionProfiles())
			}
			setHealth(asRecord(connected.health))
			setCapabilities(nextCapabilities)
			setConnectedProfile(profile)
			dispatchDocument({ type: 'set_station_alias', stationAlias: profile.alias })
			setStatus('connected')
			return nextCapabilities
		} catch (cause) {
			client.close()
			if (clientRef.current !== client) throw cause
			clientRef.current = null
			const message = cause instanceof Error ? cause.message : String(cause)
			setStatus('error')
			setError(message)
			throw cause
		}
	}, [connectionEnabled, disconnect, dispatchDocument, ingestSnapshots])

	useEffect(() => {
		if (!connectionEnabled) disconnect()
	}, [connectionEnabled, disconnect])

	const removeProfile = useCallback((alias: string) => {
		removeConnectionProfile(alias)
		setProfiles(loadConnectionProfiles())
	}, [])

	const request = useCallback((op: string, fields: Record<string, unknown> = {}, timeoutMs?: number) => {
		const client = clientRef.current
		if (!client) return Promise.reject(new Error('Connect to a station first.'))
		return client.request(op, fields, timeoutMs)
	}, [])

	const browse = useCallback(async (ord: string) => {
		const response = await request('browse', { base: ord, depth: 1, metadata: 'full' })
		const node = response.node as StationNode | undefined
		return node?.children || []
	}, [request])

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
		const client = clientRef.current
		setSelectedPointState(node)
		if (!node) return
		try {
			const response = await request('read', {
				points: [node.slotPath || node.ord],
				fields: ['value', 'displayValue', 'status', 'timestamp', 'type'],
			})
			if (clientRef.current === client) ingestSnapshots(response.points)
		} catch (cause) {
			if (clientRef.current === client) setError(cause instanceof Error ? cause.message : String(cause))
		}
	}, [ingestSnapshots, request])

	const readPoints = useCallback(async (pointReferences: string[]) => {
		const client = clientRef.current
		const uniquePoints = [...new Set(pointReferences.map((point) => point.trim()).filter(Boolean))]
		if (uniquePoints.length === 0) return []
		if (uniquePoints.length > 100) throw new Error('Read requests are limited to 100 points at a time.')
		const response = await request('read', {
			points: uniquePoints,
			fields: ['value', 'displayValue', 'status', 'timestamp', 'type'],
		})
		if (client !== clientRef.current) throw new Error('The station connection changed during the read.')
		ingestSnapshots(response.points)
		return Array.isArray(response.points) ? response.points as PointSnapshot[] : []
	}, [request, ingestSnapshots])

	const readPoint = useCallback(async (node: StationNode) => {
		const points = await readPoints([node.slotPath || node.ord])
		return points[0]
	}, [readPoints])

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

	const loadHistory = useCallback(async (widgetId: string, pointReference: string, rangeMs: number) => {
		const client = clientRef.current
		if (!client) return
		const key = historySeriesKey(widgetId, pointReference)
		const requestId = Symbol()
		historyRequests.current.set(key, requestId)
		setHistorySeries((current) => ({
			...current,
			[key]: { ...current[key], loading: true, error: undefined, records: current[key]?.records || [] },
		}))
		const end = Date.now()
		const start = end - rangeMs
		try {
			const response = await request('read_history', { ord: pointReference, start, end, limit: 2_000 }, 25_000)
			if (clientRef.current !== client || historyRequests.current.get(key) !== requestId) return
			const history = asRecord(response.history)
			const histories = Array.isArray(history.histories) ? history.histories : []
			const first = asRecord(histories[0])
			const records = Array.isArray(first.records)
				? first.records.map(asHistoryRecord).filter((record): record is HistoryRecord => Boolean(record))
				: []
			setHistorySeries((current) => ({
				...current,
				[key]: {
					loading: false,
					records,
					display: typeof first.display === 'string' ? first.display : undefined,
					historyOrd: typeof first.historyOrd === 'string' ? first.historyOrd : undefined,
					start,
					end,
				},
			}))
		} catch (cause) {
			if (clientRef.current !== client || historyRequests.current.get(key) !== requestId) return
			setHistorySeries((current) => ({
				...current,
				[key]: {
					loading: false,
					error: cause instanceof Error ? cause.message : String(cause),
					records: current[key]?.records || [],
					start,
					end,
				},
			}))
		}
	}, [request])

	const activePoints = useMemo(() => Array.from(new Set(
		[
			...document.bindings
			.filter((binding) => binding.stationAlias === connectedProfile?.alias)
			.filter((binding) => pageShapeIds.includes(binding.shapeId))
			.map((binding) => binding.pointReference),
			...widgetPointReferences,
		]
	)).sort(), [connectedProfile?.alias, document.bindings, widgetPointReferences, pageShapeIds])

	useEffect(() => {
		if (status !== 'connected' || !clientRef.current) return
		const client = clientRef.current
		let cancelled = false
		const viewGroups = capabilities?.operations?.includes('replace_subscriptions') && capabilities.subscriptions?.viewGroups
		if (viewGroups) {
			void client.request('replace_subscriptions', {
				group: 'canvas:active',
				points: activePoints,
				leaseSec: Math.min(capabilities?.limits?.subscriptionLeaseSec || 300, 300),
			}).then((response) => {
				if (!cancelled) ingestSnapshots(response.points)
			}).catch((cause) => {
				if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
			})
		} else {
			const previous = directSubscriptions.current
			const desired = new Set(activePoints)
			const added = activePoints.filter((point) => !previous.has(point))
			const removed = [...previous].filter((point) => !desired.has(point))
			if (added.length) void client.request('subscribe', { points: added }).then((response) => {
				if (!cancelled && clientRef.current === client) ingestSnapshots(response.points)
			}).catch(() => undefined)
			if (removed.length) void client.request('unsubscribe', { points: removed }).catch(() => undefined)
			directSubscriptions.current = desired
		}
		return () => { cancelled = true }
	}, [activePoints, capabilities, ingestSnapshots, status])

	useEffect(() => {
		if (status !== 'connected' || !capabilities?.subscriptions?.leasedGroups) return
		const leaseSec = Math.min(capabilities.limits?.subscriptionLeaseSec || 300, 300)
		const timer = window.setInterval(() => {
			void clientRef.current?.request('renew_subscriptions', {
				group: 'canvas:active',
				leaseSec,
			}).catch(() => undefined)
		}, Math.max(30, Math.floor(leaseSec * 0.7)) * 1_000)
		return () => window.clearInterval(timer)
	}, [capabilities, status])

	useEffect(() => () => clientRef.current?.close(), [])

	return {
		activePoints,
		browse,
		capabilities,
		connect,
		connectedProfile,
		createBinding,
		disconnect,
		document,
		error,
		health,
		historySeries,
		loadHistory,
		profiles,
		removeBinding,
		readPoint,
		readPoints,
		setBindingEnabled,
		removeProfile,
		search,
		selectedPoint,
		setSelectedPoint,
		snapshots,
		status,
		updateBinding,
	}
}

export function historySeriesKey(widgetId: string, pointReference: string) {
	return `${widgetId}:${pointReference}`
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asHistoryRecord(value: unknown): HistoryRecord | null {
	const record = asRecord(value)
	if (typeof record.timestamp !== 'number') return null
	return {
		timestamp: record.timestamp,
		value: record.value,
		valueType: typeof record.valueType === 'string' ? record.valueType : undefined,
		status: typeof record.status === 'string' ? record.status : undefined,
		recordType: typeof record.recordType === 'string' ? record.recordType : undefined,
	}
}

function asCapabilities(value: unknown): Capabilities {
	return asRecord(value) as Capabilities
}

export type BasWorkspace = ReturnType<typeof useBasWorkspace>
