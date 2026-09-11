import {
	DefaultStylePanel, DefaultStylePanelContent, TldrawUiButton,
	TldrawUiButtonLabel, TldrawUiInput, useEditor, useValue,
	type TLUiStylePanelProps,
} from 'tldraw'
import { useBasRuntime } from './BasRuntimeContext'
import { DataWidgetScaleControl } from './DataWidgetScaleControl'
import { BehaviorInspector } from './BehaviorInspector'
import { ShapeIdentityPanel } from './ShapeIdentityPanel'
import { useDataShapeDialog } from './DataShapeDialog'
import { WebViewSettings } from './WebViewSettings'
import { WEB_VIEW_TYPE } from './WebViewShape'
import { BAS_TABLE_SHAPE_TYPE, BAS_TREND_SHAPE_TYPE, type BasTableShape, type BasTrendShape } from './DataWidgetShapes'

export type DataShape = BasTableShape | BasTrendShape

export function DataShapeStylePanel(props: TLUiStylePanelProps) {
	const editor = useEditor()
	const shape = useValue('selected data shape', () => editor.getOnlySelectedShape(), [editor])
	const isData = shape?.type === BAS_TABLE_SHAPE_TYPE || shape?.type === BAS_TREND_SHAPE_TYPE
	return <DefaultStylePanel {...props}>
		{shape && <ShapeIdentityPanel key={`identity:${shape.id}`} shape={shape} />}
		{shape ? <details className="bas-appearance-section" open><summary>Appearance</summary><DefaultStylePanelContent /></details> : <DefaultStylePanelContent />}
		{isData && <DataShapeSettings key={`data:${shape.id}`} shape={shape} />}
		{shape?.type === WEB_VIEW_TYPE && <WebViewSettings key={shape.id} shape={shape} />}
		{shape && <BehaviorInspector key={`behaviors:${shape.id}`} shape={shape} />}
	</DefaultStylePanel>
}

function DataShapeSettings({ shape }: { shape: DataShape }) {
	const editor = useEditor()
	const open = useDataShapeDialog()
	const runtime = useBasRuntime()
	const connected = runtime.connected && runtime.stationAlias === shape.props.stationAlias
	const table = shape.type === BAS_TABLE_SHAPE_TYPE
	const update = (props: Partial<DataShape['props']>, label: string) => {
		if (shape.isLocked || editor.getIsReadonly()) return
		editor.markHistoryStoppingPoint(label)
		editor.updateShape({ id: shape.id, type: shape.type, props })
	}
	const rename = (title: string) => {
		if (title.trim() && title.trim() !== shape.props.title) update({ title: title.trim() }, 'rename data shape')
	}
	return <section className="bas-native-settings" aria-label={table ? 'Table settings' : 'Trend settings'}>
		<strong>{table ? 'Table' : 'Trend'}</strong>
		<DataWidgetScaleControl key={`${shape.id}:${shape.props.contentScale ?? 1}`} shapeId={shape.id} scale={shape.props.contentScale} />
		<TldrawUiInput key={shape.props.title} aria-label="Data shape title" defaultValue={shape.props.title} onComplete={rename} onBlur={rename} />
		{table ? <label className="bas-native-check">
			<input type="checkbox" checked={shape.props.showStatus} onChange={(event) => update({ showStatus: event.target.checked }, 'change table status')} />
			Show point status
		</label> : <>
			<label>Range<select value={shape.props.rangeMs} onChange={(event) => update({ rangeMs: Number(event.target.value) }, 'change trend range')}>
				<option value={3_600_000}>1 hour</option><option value={21_600_000}>6 hours</option><option value={86_400_000}>24 hours</option><option value={604_800_000}>7 days</option><option value={2_592_000_000}>30 days</option>
			</select></label>
			<label>Line<select value={shape.props.lineMode} onChange={(event) => update({ lineMode: event.target.value }, 'change trend line')}>
				<option value="line">Straight</option><option value="smooth">Smooth</option><option value="step">Stepped</option>
			</select></label>
			{shape.props.series.map((series, index) => <label className="bas-series-color" key={series.pointReference} title={series.pointReference}>
				<span>{series.pointLabel}</span>
				<input type="color" aria-label={`${series.pointLabel} line color`} value={series.color} onChange={(event) => update({ series: shape.props.series.map((item, i) => i === index ? { ...item, color: event.target.value } : item) }, 'change series color')} />
			</label>)}
		</>}
		<TldrawUiButton type="normal" disabled={shape.isLocked} onClick={() => open(table ? 'table' : 'trend', shape)}><TldrawUiButtonLabel>{table ? 'Edit table setup' : 'Edit points'}</TldrawUiButtonLabel></TldrawUiButton>
		<TldrawUiButton type="normal" onClick={() => { editor.setEditingShape(shape.id); editor.focus() }}><TldrawUiButtonLabel>{table ? 'Inspect table' : 'Inspect chart'}</TldrawUiButtonLabel></TldrawUiButton>
		{!table && <TldrawUiButton type="normal" disabled={!connected} onClick={() => {
			for (const series of shape.props.series) void runtime.loadHistory(shape.id, series.pointReference, shape.props.rangeMs)
		}}><TldrawUiButtonLabel>Refresh history</TldrawUiButtonLabel></TldrawUiButton>}
		{!connected && <small>Connect to {shape.props.stationAlias} to edit points or load values.</small>}
	</section>
}
