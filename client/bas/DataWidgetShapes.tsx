import { lazy, Suspense, useMemo } from 'react'
import {
	BaseBoxShapeUtil,
	HTMLContainer,
	RecordProps,
	T,
	type TLBaseShape,
	type TLShape,
	useEditor,
	useValue,
	resizeBox,
	type TLResizeInfo,
} from 'tldraw'
import { formatSnapshot, snapshotState } from './labelPresentation'
import { useBasRuntime, useRuntimeSnapshots } from './BasRuntimeContext'
import type { DataWidgetPoint, PointSnapshot, TrendWidgetSeries } from './types'
import { dataWidgetContentStyle } from './dataWidgetSizing'

// ECharts loads only when a trend is on the canvas, so disabled or unused charts cost no bundle.
const TrendChartShape = lazy(() => import('./TrendChartShape').then((module) => ({ default: module.TrendChartShape })))

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
		return <Suspense fallback={<TrendChartPlaceholder shape={shape} />}><TrendChartShape shape={shape} /></Suspense>
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
	const pointKey = connected ? shape.props.points.map((point) => point.pointReference).join('\n') : ''
	const points = useMemo(() => pointKey ? [...new Set(pointKey.split('\n'))] : [], [pointKey])
	const snapshots = useRuntimeSnapshots(points)
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
												{shape.props.showStatus && point && <span className="bas-value-status" data-state={tableStatus(snapshot)} />}
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

function TrendChartPlaceholder({ shape }: { shape: BasTrendShape }) {
	return <HTMLContainer className="bas-data-shape" style={{ width: shape.props.w, height: shape.props.h }}>
		<div className="bas-data-card bas-trend-card" style={dataWidgetContentStyle(shape.props.w, shape.props.h, shape.props.contentScale)}>
			<DataShapeHeader title={shape.props.title} detail="" state="loading" />
		</div>
	</HTMLContainer>
}

export function DataShapeHeader({ title, detail, state }: { title: string; detail: string; state: string }) {
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

/** Table status dots use three colors; alarm and stale points both read as errors. */
function tableStatus(snapshot?: PointSnapshot) {
	const state = snapshotState(snapshot)
	return state === 'alarm' || state === 'stale' ? 'error' : state === 'override' ? 'override' : state === 'waiting' ? 'waiting' : 'ok'
}

export function rangeLabel(rangeMs: number) {
	if (rangeMs < 3_600_000) return `${Math.round(rangeMs / 60_000)} min`
	if (rangeMs < 86_400_000) return `${Math.round(rangeMs / 3_600_000)} hr`
	return `${Math.round(rangeMs / 86_400_000)} day`
}
