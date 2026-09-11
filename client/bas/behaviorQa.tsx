// Development-only integration surface. No saved store, credentials or station calls.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Tldraw, createShapeId, type Editor } from 'tldraw'
import '../index.css'
import { useBasWorkspace } from './useBasWorkspace'
import { BasWorkspaceProvider } from './BasWorkspaceContext'
import { BasRuntimeProvider } from './BasRuntimeContext'
import { PointDragProvider } from './PointDrag'
import { RuntimeShapeWrapper } from './RuntimeShapeWrapper'
import { RuntimeBindingsOverlay } from './RuntimeBindingsOverlay'
import { DataShapeStylePanel } from './DataShapeStylePanel'
import { dispatchShapeBindingAction } from './shapeBindings'
import type { PointSnapshot, StationNode, ShapeBinding } from './types'

const profile = { alias: 'fixture', name: 'Isolated fixture', stationUrl: '', username: '', tlsMode: 'strict' as const }
const points: StationNode[] = [
	{ ord: 'fixture:temperature', display: 'Supply temperature', features: ['point'] },
	{ ord: 'fixture:setpoint', display: 'Setpoint', features: ['point'] },
	{ ord: 'fixture:run', display: 'Fan command', features: ['point'] },
]
const shapeId = createShapeId('behavior-qa')
const components = { ShapeWrapper: RuntimeShapeWrapper, InFrontOfTheCanvas: RuntimeBindingsOverlay, StylePanel: DataShapeStylePanel }

function Fixture() {
	const [editor, setEditor] = useState<Editor | null>(null)
	const [run, setRun] = useState(false)
	const [temperature, setTemperature] = useState(72.4)
	const [proof, setProof] = useState('')
	const workspace = useBasWorkspace(editor)
	const snapshots: Record<string, PointSnapshot> = {
		'fixture:temperature': { point: 'fixture:temperature', value: temperature, displayValue: `${temperature} °F`, status: 'ok' },
		'fixture:setpoint': { point: 'fixture:setpoint', value: 74, displayValue: '74 °F', status: 'override' },
		'fixture:run': { point: 'fixture:run', value: run, status: 'ok' },
	}
	return <BasWorkspaceProvider workspace={{ ...workspace, connectedProfile: profile, status: 'connected', snapshots,
		search: async (query) => points.filter((point) => point.display!.toLowerCase().includes(query.toLowerCase())),
		browse: async () => points,
		readPoint: async (point) => snapshots[point.ord],
		createBinding: (owner, property, mapping, options, point, name) => editor && point ? dispatchShapeBindingAction(editor, { type: 'create_binding', binding: { id: crypto.randomUUID(), shapeId: owner, name, stationAlias: 'fixture', pointReference: point.ord, pointLabel: point.display!, runtimeProperty: property, mapping, options } }) : 'Select a fixture point.',
	}}><PointDragProvider><BasRuntimeProvider value={{ document: workspace.document, snapshots, connected: true, stationAlias: 'fixture', historySeries: {}, loadHistory: async () => {} }}>
		<div style={{ position: 'absolute', inset: 0 }}>
			<div style={{ height: 60, padding: 8 }}>Isolated behavior QA · synthetic values · no saved drawing or station connection
				<label> Temperature <input aria-label="Fixture temperature" type="number" value={temperature} onChange={(event) => setTemperature(Number(event.target.value))} /></label>
				<button onClick={() => setRun((value) => !value)}>{run ? 'Stop fixture fan' : 'Start fixture fan'}</button>
				<button onClick={() => {
					if (!editor) return
					const effects: Pick<ShapeBinding, 'runtimeProperty' | 'options'>[] = [
						{ runtimeProperty: 'rotation', options: { kind: 'rotation', mode: 'spin', secondsPerTurn: 2, direction: 'clockwise', restAngle: 0 } },
						{ runtimeProperty: 'movement', options: { kind: 'movement', mode: 'travel', axis: 'x', direction: 'positive', distance: 180, secondsPerCycle: 3 } },
						{ runtimeProperty: 'levelFill', options: { kind: 'levelFill', direction: 'up', color: '#34a853' } },
					]
					for (const effect of effects) dispatchShapeBindingAction(editor, { type: 'create_binding', binding: {
						id: `qa-${effect.runtimeProperty}`, shapeId, stationAlias: 'fixture', pointReference: effect.runtimeProperty === 'levelFill' ? 'fixture:temperature' : 'fixture:run', pointLabel: 'Fixture', mapping: { kind: 'auto' }, ...effect,
					} })
					setRun(true)
				}}>Add motion fixture</button>
				<button onClick={async () => {
					if (!editor) return
					const before = JSON.stringify(editor.store.serialize('document'))
					setProof('Checking…')
					await new Promise(resolve => setTimeout(resolve, 700))
					setProof(before === JSON.stringify(editor.store.serialize('document')) ? 'PASS: animation leaves document unchanged' : 'FAIL: document changed')
				}}>Check saved geometry</button><output>{proof}</output>
			</div>
			<div style={{ position: 'absolute', inset: '60px 0 0' }}><Tldraw components={components} onMount={(mounted) => {
				mounted.updateDocumentSettings({ meta: { basBindingsVersion: 1 } })
				mounted.createShape({ id: shapeId, type: 'geo', x: 300, y: 250, props: { w: 160, h: 100 }, meta: { basName: 'Fixture equipment' } })
				for (const [index, point] of points.slice(0, 2).entries()) {
					const binding: ShapeBinding = { id: `value-${index}`, shapeId, name: point.display, stationAlias: 'fixture', pointReference: point.ord, pointLabel: point.display!, runtimeProperty: 'label', mapping: { kind: 'auto' }, options: { kind: 'label', placement: 'bottom', gap: 8, stackGap: 6, caption: index ? 'Setpoint' : 'Supply', background: index ? 'none' : 'solid' } }
					dispatchShapeBindingAction(mounted, { type: 'create_binding', binding })
				}
				mounted.select(shapeId)
				setEditor(mounted)
			}} /></div>
		</div>
	</BasRuntimeProvider></PointDragProvider></BasWorkspaceProvider>
}

if (import.meta.env.DEV) {
	const root = createRoot(document.getElementById('root')!)
	root.render(<Fixture />)
	import.meta.hot?.dispose(() => root.unmount())
}
