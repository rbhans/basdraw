import { useEffect, useMemo, useRef } from 'react'
import {
	BaseBoxShapeUtil,
	HTMLContainer,
	RecordProps,
	T,
	type TLBaseShape,
	type TLShape,
	useColorMode,
	useEditor,
	useValue,
	resizeBox,
	type TLResizeInfo,
} from 'tldraw'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { DataZoomComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import { formatSnapshot } from './RuntimeBindingsOverlay'
import { useBasRuntime } from './BasRuntimeContext'
import { historySeriesKey } from './useBasWorkspace'
import type { DataWidgetPoint, TrendWidgetSeries } from './types'
import { dataWidgetContentStyle } from './dataWidgetSizing'

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, DataZoomComponent, SVGRenderer])

export const BAS_TABLE_SHAPE_TYPE = 'bas-table' as const
export const BAS_TREND_SHAPE_TYPE = 'bas-trend' as const

export type BasTableShape = TLBaseShape<typeof BAS_TABLE_SHAPE_TYPE, {
	w: number
	h: number
	contentScale?: number
	title: string
	stationAlias: string
	points: DataWidgetPoint[]
	showStatus: boolean
}>

export type BasTrendShape = TLBaseShape<typeof BAS_TREND_SHAPE_TYPE, {
	w: number
	h: number
	contentScale?: number
	title: string
	stationAlias: string
	series: TrendWidgetSeries[]
	rangeMs: number
	lineMode: string
}>

declare module '@tldraw/tlschema' {
	interface TLGlobalShapePropsMap {
		[BAS_TABLE_SHAPE_TYPE]: BasTableShape['props']
		[BAS_TREND_SHAPE_TYPE]: BasTrendShape['props']
	}
}

const dataPointValidator = T.object({
	pointReference: T.string,
	pointLabel: T.string,
	equipmentReference: T.string,
	equipmentLabel: T.string,
	fieldKey: T.string,
	fieldLabel: T.string,
})

const trendSeriesValidator = T.object({
	pointReference: T.string,
	pointLabel: T.string,
	color: T.string,
})

export class BasTableShapeUtil extends BaseBoxShapeUtil<BasTableShape> {
	static override type = BAS_TABLE_SHAPE_TYPE
	static override props: RecordProps<BasTableShape> = {
		w: T.number,
		h: T.number,
		contentScale: T.number.check((value) => { if (value < 0.25 || value > 4) throw new Error("Content scale must be between 25% and 400%") }).optional(),
		title: T.string,
		stationAlias: T.string,
		points: T.arrayOf(dataPointValidator),
		showStatus: T.boolean,
	}

	getDefaultProps(): BasTableShape['props'] {
		return { w: 520, h: 260, title: 'Equipment values', stationAlias: '', points: [], showStatus: true }
	}

	override canResize() { return true }
	override canEdit() { return true }
	override isAspectRatioLocked() { return false }
	override onResize(shape: BasTableShape, info: TLResizeInfo<BasTableShape>) {
		return resizeBox(shape, info, { minWidth: 280, minHeight: 128 })
	}

	component(shape: BasTableShape) {
		return <DataTableShape shape={shape} />
	}
	override getText(shape: BasTableShape) { return shape.props.title }

	getIndicatorPath(shape: BasTableShape) {
		const path = new Path2D()
		path.roundRect(0, 0, shape.props.w, shape.props.h, 8)
		return path
	}
}

export class BasTrendShapeUtil extends BaseBoxShapeUtil<BasTrendShape> {
	static override type = BAS_TREND_SHAPE_TYPE
	static override props: RecordProps<BasTrendShape> = {
		w: T.number,
		h: T.number,
		contentScale: T.number.check((value) => { if (value < 0.25 || value > 4) throw new Error("Content scale must be between 25% and 400%") }).optional(),
		title: T.string,
		stationAlias: T.string,
		series: T.arrayOf(trendSeriesValidator),
		rangeMs: T.number,
		lineMode: T.string,
	}

	getDefaultProps(): BasTrendShape['props'] {
		return { w: 560, h: 320, title: 'Point history', stationAlias: '', series: [], rangeMs: 86_400_000, lineMode: 'line' }
	}

	override canResize() { return true }
	override canEdit() { return true }
	override isAspectRatioLocked() { return false }
	override onResize(shape: BasTrendShape, info: TLResizeInfo<BasTrendShape>) {
		return resizeBox(shape, info, { minWidth: 320, minHeight: 220 })
	}

	component(shape: BasTrendShape) {
		return <TrendChartShape shape={shape} />
	}
	override getText(shape: BasTrendShape) { return shape.props.title }

	getIndicatorPath(shape: BasTrendShape) {
		const path = new Path2D()
		path.roundRect(0, 0, shape.props.w, shape.props.h, 8)
		return path
	}
}

export const dataWidgetShapeUtils = [BasTableShapeUtil, BasTrendShapeUtil]

export function dataWidgetPointReferences(shapes: TLShape[], stationAlias?: string | null) {
	const refs = shapes.flatMap((shape) => {
		if (shape.type === BAS_TABLE_SHAPE_TYPE) {
			const table = shape as BasTableShape
			if (stationAlias && table.props.stationAlias !== stationAlias) return []
			return table.props.points.map((point) => point.pointReference)
		}
		return []
	})
	return Array.from(new Set(refs))
}

function DataTableShape({ shape }: { shape: BasTableShape }) {
	const runtime = useBasRuntime()
	const connected = runtime.connected && runtime.stationAlias === shape.props.stationAlias
	const snapshots = connected ? runtime.snapshots : {}
	const editor = useEditor()
	const editing = useValue('table editing', () => editor.getEditingShapeId() === shape.id, [editor, shape.id])
	const rows = useMemo(() => tableRows(shape.props.points), [shape.props.points])
	const columns = useMemo(() => tableColumns(shape.props.points), [shape.props.points])

	return (
		<HTMLContainer className={`bas-data-shape ${editing ? 'is-inspecting' : ''}`} style={{ width: shape.props.w, height: shape.props.h }}
			onPointerDown={editing ? (event) => event.stopPropagation() : undefined}
			onWheel={editing ? (event) => event.stopPropagation() : undefined}>
			<div className="bas-data-card bas-table-card" style={dataWidgetContentStyle(shape.props.w, shape.props.h, shape.props.contentScale)}>
				<DataShapeHeader title={shape.props.title} detail={`${rows.length} equipment`} state={connected ? 'live' : 'offline'} />
				<div className="bas-table-scroll">
					<table>
						<thead>
							<tr>
								<th>Equipment</th>
								{columns.map((column) => <th key={column.key}>{column.label}</th>)}
							</tr>
						</thead>
						<tbody>
							{rows.map((row) => (
								<tr key={row.reference}>
									<th>{row.label}</th>
									{columns.map((column) => {
										const point = shape.props.points.find((candidate) => candidate.equipmentReference === row.reference && candidate.fieldKey === column.key)
										const snapshot = point ? snapshots[point.pointReference] : undefined
										return (
											<td key={column.key} title={point?.pointReference}>
												{shape.props.showStatus && point && <span className="bas-value-status" data-state={snapshotState(snapshot)} />}
												<span>{snapshot ? formatSnapshot(snapshot) : point ? connected ? 'Waiting…' : 'Offline' : '—'}</span>
											</td>
										)
									})}
								</tr>
							))}
						</tbody>
					</table>
				</div>
				<div className="bas-table-hint">{editing ? 'Scroll to inspect · Escape to finish' : 'Double-click to scroll'}</div>
			</div>
		</HTMLContainer>
	)
}

function TrendChartShape({ shape }: { shape: BasTrendShape }) {
	const { connected: stationConnected, stationAlias, historySeries, loadHistory } = useBasRuntime()
	const connected = stationConnected && stationAlias === shape.props.stationAlias
	const editor = useEditor()
	const colorMode = useColorMode()
	const editing = useValue('trend chart editing', () => editor.getEditingShapeId() === shape.id, [editor, shape.id])
	const chartElement = useRef<HTMLDivElement>(null)
	const chart = useRef<echarts.ECharts | null>(null)
	const seriesKey = shape.props.series.map((series) => series.pointReference).join('|')

	useEffect(() => {
		if (!connected) return
		for (const series of shape.props.series) void loadHistory(shape.id, series.pointReference, shape.props.rangeMs)
	}, [connected, loadHistory, seriesKey, shape.id, shape.props.rangeMs, shape.props.series])

	const states = useMemo(
		() => shape.props.series.map((series) => connected ? historySeries[historySeriesKey(shape.id, series.pointReference)] : undefined),
		[connected, historySeries, seriesKey, shape.id, shape.props.series],
	)
	const loading = states.some((state) => state?.loading)
	const error = states.find((state) => state?.error)?.error
	const pointCount = states.reduce((count, state) => count + (state?.records.length || 0), 0)

	useEffect(() => {
		const element = chartElement.current
		if (!element) return
		const instance = echarts.init(element, undefined, { renderer: 'svg' })
		chart.current = instance
		const observer = new ResizeObserver(() => instance.resize())
		observer.observe(element)
		return () => {
			observer.disconnect()
			instance.dispose()
			chart.current = null
		}
	}, [])

	useEffect(() => {
		const instance = chart.current
		const element = chartElement.current
		if (!instance || !element) return
		// ThemeSync updates the surrounding shell after the tldraw preference.
		// Resolve CSS colors on the next frame, once both theme classes agree.
		const frame = requestAnimationFrame(() => {
		const styles = getComputedStyle(element)
		const text = styles.getPropertyValue('--tl-color-text').trim() || (colorMode === 'dark' ? '#f1f1f1' : '#1d1d1d')
		const muted = styles.getPropertyValue('--tl-color-text-3').trim() || '#767676'
		const divider = styles.getPropertyValue('--tl-color-divider').trim() || '#dddddd'
		instance.setOption({
			animation: false,
			color: shape.props.series.map((series) => series.color),
			grid: { left: 46, right: 18, top: shape.props.series.length > 1 ? 34 : 16, bottom: 44, containLabel: false },
			legend: { show: shape.props.series.length > 1, top: 0, right: 14, textStyle: { color: muted, fontFamily: 'var(--tl-font-sans)', fontSize: 11 } },
			tooltip: {
				show: editing,
				trigger: 'axis',
				confine: true,
				backgroundColor: styles.getPropertyValue('--tl-color-panel').trim(),
				borderColor: divider,
				textStyle: { color: text, fontFamily: 'var(--tl-font-sans)', fontSize: 12 },
				valueFormatter: formatChartValue,
			},
			xAxis: { type: 'time', min: states.find((state) => state?.start)?.start, max: states.find((state) => state?.end)?.end, axisLine: { lineStyle: { color: divider } }, axisTick: { show: false }, axisLabel: { color: muted, fontSize: 10 }, splitLine: { show: false } },
			yAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: muted, fontSize: 10 }, splitLine: { lineStyle: { color: divider, type: 'dashed' } } },
			dataZoom: editing ? [{ type: 'inside', filterMode: 'none' }] : [],
			series: shape.props.series.map((series, index) => ({
				name: series.pointLabel,
				type: 'line',
				showSymbol: false,
				smooth: shape.props.lineMode === 'smooth' ? 0.22 : false,
				step: shape.props.lineMode === 'step' ? 'end' : false,
				lineStyle: { width: 2 },
				connectNulls: false,
				data: (states[index]?.records || [])
					.map((record) => [record.timestamp, numericHistoryValue(record.value)]),
			})),
		}, true)
		})
		return () => cancelAnimationFrame(frame)
	}, [colorMode, editing, pointCount, shape.props.lineMode, shape.props.series, states])

	return (
		<HTMLContainer
			className={`bas-data-shape ${editing ? 'is-inspecting' : ''}`}
			style={{ width: shape.props.w, height: shape.props.h, pointerEvents: 'all' }}
			onPointerDown={editing ? (event) => event.stopPropagation() : undefined}
			onWheel={editing ? (event) => event.stopPropagation() : undefined}
		>
			<div className="bas-data-card bas-trend-card" style={dataWidgetContentStyle(shape.props.w, shape.props.h, shape.props.contentScale)}>
				<DataShapeHeader title={shape.props.title} detail={rangeLabel(shape.props.rangeMs)} state={connected ? loading ? 'loading' : error ? 'error' : 'history' : 'offline'} />
				<div className="bas-trend-chart" ref={chartElement} />
				{!connected && <div className="bas-chart-message">Connect to load history</div>}
				{connected && loading && pointCount === 0 && <div className="bas-chart-message">Loading history…</div>}
				{connected && error && pointCount === 0 && <div className="bas-chart-message is-error">{error}</div>}
				{connected && !loading && !error && pointCount === 0 && <div className="bas-chart-message">No numeric history in this range</div>}
				<div className="bas-chart-hint">{error && pointCount > 0 ? 'Some history could not load' : states.some((state) => (state?.records.length || 0) >= 2000) ? 'Sample limit reached · try a shorter range' : editing ? 'Scroll or drag to inspect · Escape to finish' : 'Double-click to inspect'}</div>
			</div>
		</HTMLContainer>
	)
}

function DataShapeHeader({ title, detail, state }: { title: string; detail: string; state: string }) {
	return (
		<header className="bas-data-card-header">
			<div><strong>{title}</strong><span>{detail}</span></div>
			<small data-state={state}>{state}</small>
		</header>
	)
}

function tableRows(points: DataWidgetPoint[]) {
	return Array.from(new Map(points.map((point) => [point.equipmentReference, { reference: point.equipmentReference, label: point.equipmentLabel }])).values())
}

function tableColumns(points: DataWidgetPoint[]) {
	return Array.from(new Map(points.map((point) => [point.fieldKey, { key: point.fieldKey, label: point.fieldLabel }])).values())
}

function snapshotState(snapshot?: { ok?: boolean; status?: string }) {
	if (!snapshot) return 'waiting'
	if (snapshot.ok === false || /fault|down|alarm|stale|unacked/i.test(snapshot.status || '')) return 'error'
	if (/overrid|forced/i.test(snapshot.status || '')) return 'override'
	return 'ok'
}

function numericHistoryValue(value: unknown) {
	if (typeof value === 'number' && Number.isFinite(value)) return value
	if (typeof value === 'boolean') return value ? 1 : 0
	const parsed = typeof value === 'string' && value.trim() ? Number(value) : Number.NaN
	return Number.isFinite(parsed) ? parsed : null
}

function formatChartValue(value: unknown) {
	if (typeof value === 'number') return value.toLocaleString(undefined, { maximumFractionDigits: 3 })
	return String(value ?? '—')
}

function rangeLabel(rangeMs: number) {
	if (rangeMs < 3_600_000) return `${Math.round(rangeMs / 60_000)} min`
	if (rangeMs < 86_400_000) return `${Math.round(rangeMs / 3_600_000)} hr`
	return `${Math.round(rangeMs / 86_400_000)} day`
}
