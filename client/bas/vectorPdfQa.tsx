import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Tldraw, DefaultToolbar, TldrawUiMenuItem, createShapeId, getSnapshot, loadSnapshot, useDialogs, type Editor } from 'tldraw'
import '../index.css'
import { insertVectorPage, splitVectorPage, svgDataUrl, type VectorPage } from './vectorPdfImport'
import { useVectorPdfDialog, VectorPdfDialog } from './VectorPdfDialog'
import { RuntimeShapeWrapper } from './RuntimeShapeWrapper'
import { RuntimeBindingsOverlay } from './RuntimeBindingsOverlay'
import { BasRuntimeProvider } from './BasRuntimeContext'
import { useBasWorkspace } from './useBasWorkspace'
import { dispatchShapeBindingAction } from './shapeBindings'
import { checkPdfFillInteriors, coilOutlineSvg } from './pdfFillQaChecks'
// @ts-expect-error In-memory JavaScript fixture shared with node:test.
import { samplePdf } from '../../scripts/pdf-fixture.mjs'

function Toolbar() { const open = useVectorPdfDialog(); const { addDialog } = useDialogs(); return <DefaultToolbar><TldrawUiMenuItem id="pdf" label="Import vector PDF" icon="plus" onSelect={open} /><TldrawUiMenuItem id="sample-pdf" label="Preview sample PDF" icon="file" onSelect={() => { addDialog({ component: props => <VectorPdfDialog {...props} initialFile={new File([samplePdf()], 'sample-controls.pdf', { type: 'application/pdf' })} /> }) }} /></DefaultToolbar> }
const components = { Toolbar, ShapeWrapper: RuntimeShapeWrapper, InFrontOfTheCanvas: RuntimeBindingsOverlay }
async function convert(raster = false) {
	const response = await fetch('http://127.0.0.1:8790/pdf', { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-Basdraw-Import': '1' }, body: samplePdf({ raster }) })
	const result = await response.json() as { svg: string; error?: string }
	if (!response.ok) throw new Error(result.error)
	return splitVectorPage(result.svg)
}
async function comparePixels(page: VectorPage) {
	const canvas = () => { const c = document.createElement('canvas'); c.width = page.width; c.height = page.height; const ctx = c.getContext('2d')!; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, c.width, c.height); return ctx }
	const expected = canvas(), actual = canvas()
	const image = async (svg: string) => { const img = new Image(); img.src = svgDataUrl(svg); await img.decode(); return img }
	expected.drawImage(await image(page.preview), 0, 0, page.width, page.height)
	for (const piece of page.pieces) actual.drawImage(await image(piece.svg), piece.x, piece.y, piece.w, piece.h)
	const a = actual.getImageData(0, 0, page.width, page.height).data, b = expected.getImageData(0, 0, page.width, page.height).data
	let error = 0
	for (let i = 0; i < a.length; i++) error += Math.abs(a[i] - b[i])
	return error / a.length
}
function Fixture() {
	const [editor, setEditor] = useState<Editor | null>(null), [results, setResults] = useState<string[]>([]), [running, setRunning] = useState(false), [busy, setBusy] = useState(false)
	const workspace = useBasWorkspace(editor)
	const check = async () => {
		if (!editor || busy) return
		setBusy(true); setResults([])
		const pass = (value: string) => setResults(previous => [...previous, `PASS: ${value}`])
		const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }
		try {
			pass(await checkPdfFillInteriors())
			const page = await convert()
			assert(page.width === 600 && page.height === 400 && page.pieces.length > 5, 'page dimensions / pieces')
			pass(`Local conversion preserves page scale and separates ${page.pieces.length} painted pieces`)
			assert(page.pieces.some(p => p.kind === 'text'), 'text runs missing')
			const error = await comparePixels(page)
			assert(error < 1.5, `Visual mismatch: mean channel difference ${error.toFixed(3)}`)
			pass(`Split vectors match original SVG, including clipping, rotation and glyphs (mean pixel error ${error.toFixed(3)}/255)`)
			let rejected = false
			try { await convert(true) } catch (e) { rejected = String(e).includes('scanned') }
			assert(rejected, 'scan not rejected'); pass('Scanned page rejected')
			rejected = false
			try { splitVectorPage('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><use href="https://example.com/a.svg#x"/></svg>') } catch { rejected = true }
			assert(rejected, 'external reference not rejected'); pass('External SVG references rejected')
			const before = editor.getCurrentPageShapes().length
			const imported = insertVectorPage(editor, page, 'QA control drawing')
			const added = editor.getCurrentPageShapes().length
			assert(added === before + page.pieces.length + 2, 'native shapes missing')
			const firstPiece = editor.getShape(imported.pieces[0])
			assert(firstPiece && editor.getShapeUtil(firstPiece).isAspectRatioLocked(firstPiece), 'Imported pieces do not preserve proportions while resizing')
			pass('Imported pieces keep their proportions with native tldraw resize handles')
			editor.undo(); assert(editor.getCurrentPageShapes().length === before, 'undo not atomic')
			editor.redo(); assert(editor.getCurrentPageShapes().length === added, 'redo failed')
			pass('Import, undo and redo are one native operation')
			const fan = imported.pieces.filter((_, i) => { const p = page.pieces[i]; return p.kind === 'vector' && Math.abs(p.x + p.w / 2 - 220) < 1 && Math.abs(p.y + p.h / 2 - 260) < 1 })
			assert(fan.length >= 2, 'fan paths unavailable for grouping')
			editor.select(...fan); editor.groupShapes(fan)
			const group = editor.getOnlySelectedShape()!
			assert(group.type === 'group', 'native grouping failed')
			dispatchShapeBindingAction(editor, { type: 'create_binding', binding: { id: 'qa-fan', shapeId: group.id, stationAlias: 'fixture', pointReference: 'fixture:run', pointLabel: 'Fan run', runtimeProperty: 'rotation', mapping: { kind: 'auto' }, options: { kind: 'rotation', mode: 'spin', secondsPerTurn: 2, direction: 'clockwise', restAngle: 0 } } })
			dispatchShapeBindingAction(editor, { type: 'create_binding', binding: { id: 'qa-fill', shapeId: group.id, stationAlias: 'fixture', pointReference: 'fixture:level', pointLabel: 'Level', runtimeProperty: 'levelFill', mapping: { kind: 'auto' }, options: { kind: 'levelFill', direction: 'up', color: '#4488ff' } } })
			const snapshot = getSnapshot(editor.store)
			loadSnapshot(editor.store, snapshot)
			assert(editor.getShape(group.id)?.type === 'group', 'group reload failed')
			assert(editor.getCurrentPageShapes().filter(s => s.type === 'image').every(s => !!editor.getAsset(s.props.assetId!)), 'embedded asset reload failed')
			pass('Imported pieces group natively and survive snapshot reload with SVG assets and a rotation binding')
			// Exercise both runtime render paths with the real coil outline, in isolation.
			const coilPage = splitVectorPage(coilOutlineSvg)
			const coils = insertVectorPage(editor, coilPage, 'Outline coil fill QA')
			const coil = editor.getShape(coils.pieces[0])!
			editor.updateShape({ id: coil.id, type: 'image', props: { w: 160, h: 160 } })
			editor.reparentShapes([coil.id], editor.getCurrentPageId())
			editor.updateShape({ id: coil.id, type: 'image', x: 0, y: -500 })
			const firstCoil = createShapeId(), secondCoil = createShapeId()
			editor.createShapes([{ ...editor.getShape(coil.id)!, id: firstCoil, x: 200 }, { ...editor.getShape(coil.id)!, id: secondCoil, x: 380 }])
			editor.groupShapes([firstCoil, secondCoil])
			const coilGroup = editor.getOnlySelectedShape()!
			for (const [id, shapeId, property] of [['qa-coil-status', coil.id, 'fill'], ['qa-coil-level', coilGroup.id, 'levelFill']] as const) {
				dispatchShapeBindingAction(editor, { type: 'create_binding', binding: { id, shapeId, stationAlias: 'fixture', pointReference: 'fixture:level', pointLabel: 'Coil fill', runtimeProperty: property, mapping: { kind: 'auto' }, ...(property === 'levelFill' ? { options: { kind: 'levelFill', direction: 'up', color: '#4488ff' } as const } : {}) } })
			}
			editor.select(coil.id, coilGroup.id); editor.zoomToSelection({ animation: { duration: 0 } })
			pass('Real coil fixture: single status fill and grouped 50% level fill rendered')
			setRunning(true)
			pass('Synthetic Niagara Boolean drives the imported fan group; Stop/Start toggles playback')
		} catch (error) { setResults(previous => [...previous, `FAIL: ${error instanceof Error ? error.message : String(error)}`]) }
		finally { setBusy(false) }
	}
	return <BasRuntimeProvider value={{ document: workspace.document, snapshots: { 'fixture:run': { point: 'fixture:run', value: running, status: 'ok' }, 'fixture:level': { point: 'fixture:level', value: 50, status: 'ok' } }, connected: true, stationAlias: 'fixture', historySeries: {}, loadHistory: async () => {} }}>
		<div style={{ position: 'absolute', inset: 0 }}><section style={{ height: 210, overflow: 'auto', padding: 8 }}><strong>Isolated vector PDF QA. No saved canvas or station connection.</strong><button disabled={!editor || busy} onClick={check}>Run PDF checks</button><button onClick={() => setRunning(v => !v)}>{running ? 'Stop fan' : 'Start fan'}</button><ul>{results.map((result, i) => <li key={i}>{result}</li>)}</ul></section><div style={{ position: 'absolute', inset: '210px 0 0' }}><Tldraw components={components} onMount={setEditor} /></div></div>
	</BasRuntimeProvider>
}
if (import.meta.env.DEV) { const root = createRoot(document.getElementById('root')!); root.render(<Fixture />); import.meta.hot?.dispose(() => root.unmount()) }
