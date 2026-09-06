// Isolated synthetic fixture: no saved drawing or station connection.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DataWidgetScaleControl } from './DataWidgetScaleControl'
import { Tldraw, createShapeId, useEditor, useValue, type Editor } from 'tldraw'
import '../index.css'
import { BasRuntimeProvider } from './BasRuntimeContext'
import { dataWidgetShapeUtils } from './DataWidgetShapes'
import { historySeriesKey } from './useBasWorkspace'

const table = createShapeId('sizing-table'), trend = createShapeId('sizing-trend')
const now = Date.now()
const records = Array.from({ length: 25 }, (_, i) => ({ timestamp: now - (24 - i) * 3600000, value: 70 + Math.sin(i) * 5 }))
function ScalePanel() {
	const editor = useEditor()
	const shape = useValue('fixture selection', () => editor.getOnlySelectedShape(), [editor])
	return shape && (shape.type === 'bas-table' || shape.type === 'bas-trend') ? <div style={{ padding: 12, background: 'var(--tl-color-panel)' }}><DataWidgetScaleControl key={`${shape.id}:${shape.props.contentScale}`} shapeId={shape.id} scale={shape.props.contentScale} /></div> : null
}
const components = { StylePanel: ScalePanel }
function Fixture() {
	const [editor, setEditor] = useState<Editor | null>(null)
	const resize = (id: typeof table, scale: number) => {
		if (!editor) return
		editor.markHistoryStoppingPoint('resize widget')
		editor.resizeShape(id, { x: scale, y: scale })
		editor.select(id)
	}
	return <BasRuntimeProvider value={{ document: { version: 2, stationAlias: 'fixture', bindings: [] }, connected: true, stationAlias: 'fixture', snapshots: { temperature: { point: 'temperature', value: 72.4, displayValue: '72.4 °F' } }, historySeries: { [historySeriesKey(trend, 'temperature')]: { records, loading: false, start: now - 86400000, end: now } }, loadHistory: async () => {} }}>
		<div style={{ padding: 8 }}>Isolated widget sizing QA · synthetic data
			<button onClick={() => resize(table, 2)}>Double table</button>
			<button onClick={() => resize(trend, 2)}>Double chart</button>
			<button onClick={() => { const shape = editor?.getOnlySelectedShape(); if (editor && shape) { editor.markHistoryStoppingPoint('widen widget'); editor.resizeShape(shape.id, { x: 2, y: 1 }) } }}>Widen selected</button>
			<button onClick={() => editor?.undo()}>Undo resize</button>
		</div>
		<div style={{ position: 'absolute', inset: '50px 0 0' }}><Tldraw components={components} shapeUtils={dataWidgetShapeUtils} onMount={(mounted) => {
			mounted.createShape({ id: table, type: 'bas-table', x: 30, y: 30, props: { stationAlias: 'fixture', points: [{ pointReference: 'temperature', pointLabel: 'Temperature', equipmentReference: 'AHU1', equipmentLabel: 'AHU 1', fieldKey: 'temperature', fieldLabel: 'Temperature' }] } })
			mounted.createShape({ id: trend, type: 'bas-trend', x: 580, y: 30, props: { stationAlias: 'fixture', series: [{ pointReference: 'temperature', pointLabel: 'Temperature', color: '#4263eb' }] } })
			mounted.select(table)
			setEditor(mounted)
		}} /></div>
	</BasRuntimeProvider>
}
if (import.meta.env.DEV) {
	const root = createRoot(document.getElementById('root')!)
	root.render(<Fixture />)
	import.meta.hot?.dispose(() => root.unmount())
}
