import { useEffect, useState } from 'react'
import { createShapeId, TldrawUiButton, TldrawUiButtonLabel, TldrawUiDialogHeader, TldrawUiDialogTitle, TldrawUiDialogCloseButton, TldrawUiDialogBody, TldrawUiDialogFooter, TldrawUiInput, useDialogs, useEditor, type TLUiDialogProps } from 'tldraw'
import { useWorkspace } from './BasWorkspaceContext'
import { BAS_TABLE_SHAPE_TYPE, BAS_TREND_SHAPE_TYPE, type BasTableShape, type BasTrendShape } from './DataWidgetShapes'
import { nodeLabel, type DataWidgetPoint, type StationNode } from './types'
import { pointReference, tableLayout, toDataWidgetPoint, trendColors } from './dataShapeSetup'

type DataShape = BasTableShape | BasTrendShape
export function useDataShapeDialog() {
	const { addDialog } = useDialogs()
	return (mode: 'table' | 'trend', shape?: DataShape) => addDialog({ id: 'bas-data-shape', component: (props) => <DataShapeDialog {...props} mode={mode} shape={shape} /> })
}

function DataShapeDialog({ mode, shape, onClose }: TLUiDialogProps & { mode: 'table' | 'trend'; shape?: DataShape }) {
	const editor = useEditor()
	const workspace = useWorkspace()
	const [stationAlias] = useState(shape?.props.stationAlias || workspace.connectedProfile?.alias)
	const connected = Boolean(stationAlias && workspace.connectedProfile?.alias === stationAlias)
	const [step, setStep] = useState<'points' | 'layout'>(shape ? 'layout' : 'points')
	const [title, setTitle] = useState(shape?.props.title || (mode === 'table' ? 'Equipment values' : 'Point history'))
	const [points, setPoints] = useState<DataWidgetPoint[]>(() => shape?.type === BAS_TABLE_SHAPE_TYPE ? shape.props.points : shape?.type === BAS_TREND_SHAPE_TYPE ? shape.props.series.map((point) => toDataWidgetPoint({ ord: point.pointReference, display: point.pointLabel })) : [])
	const [showStatus, setShowStatus] = useState(shape?.type === BAS_TABLE_SHAPE_TYPE ? shape.props.showStatus : true)
	const [rangeMs, setRangeMs] = useState(shape?.type === BAS_TREND_SHAPE_TYPE ? shape.props.rangeMs : 86_400_000)
	const [lineMode, setLineMode] = useState(shape?.type === BAS_TREND_SHAPE_TYPE ? shape.props.lineMode : 'line')
	const [colors, setColors] = useState<Record<string, string>>(() => shape?.type === BAS_TREND_SHAPE_TYPE ? Object.fromEntries(shape.props.series.map((series) => [series.pointReference, series.color])) : {})
	const [query, setQuery] = useState('')
	const [results, setResults] = useState<StationNode[]>([])
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState('')
	const layout = tableLayout(points)
	useEffect(() => {
		let cancelled = false
		setResults([]); setError(''); setLoading(Boolean(query.trim() && connected))
		if (!query.trim() || !connected) return
		const timer = window.setTimeout(() => { void workspace.search(query.trim()).then((nodes) => { if (!cancelled) setResults(nodes) }).catch((cause) => { if (!cancelled) setError(String(cause)) }).finally(() => { if (!cancelled) setLoading(false) }) }, 180)
		return () => { cancelled = true; window.clearTimeout(timer) }
	}, [query, connected, workspace.search])
	const toggle = (node: StationNode) => setPoints((current) => current.some((point) => point.pointReference === pointReference(node)) ? current.filter((point) => point.pointReference !== pointReference(node)) : [...current, toDataWidgetPoint(node)])
	const patch = (reference: string, change: Partial<DataWidgetPoint>) => setPoints((current) => current.map((point) => point.pointReference === reference ? { ...point, ...change } : point))
	const save = () => {
		if (!stationAlias || !points.length || !title.trim() || (mode === 'table' && layout.duplicates)) return
		if (shape && (!editor.getShape(shape.id) || editor.getShape(shape.id)?.isLocked)) { setError('This shape was removed or locked. Close this dialog and select it again.'); return }
		if (editor.getIsReadonly()) return
		const center = editor.getViewportPageBounds().center
		const id = shape?.id || createShapeId()
		editor.markHistoryStoppingPoint(shape ? 'edit data shape' : 'create data shape')
		if (mode === 'table') {
			const props = { title: title.trim(), stationAlias, points, showStatus }
			if (shape) editor.updateShape<BasTableShape>({ id, type: BAS_TABLE_SHAPE_TYPE, props })
			else {
				const w = Math.max(420, Math.min(760, 160 + layout.columns.length * 130)), h = Math.max(128, Math.min(520, 82 + layout.rows.length * 42))
				editor.createShape<BasTableShape>({ id, type: BAS_TABLE_SHAPE_TYPE, x: center.x - w / 2, y: center.y - h / 2, props: { ...props, w, h } })
			}
		} else {
			const series = points.map((point, index) => ({ pointReference: point.pointReference, pointLabel: point.pointLabel, color: colors[point.pointReference] || trendColors[index % trendColors.length] }))
			const props = { title: title.trim(), stationAlias, series, rangeMs, lineMode }
			if (shape) editor.updateShape<BasTrendShape>({ id, type: BAS_TREND_SHAPE_TYPE, props })
			else editor.createShape<BasTrendShape>({ id, type: BAS_TREND_SHAPE_TYPE, x: center.x - 280, y: center.y - 160, props: { ...props, w: 560, h: 320 } })
		}
		editor.select(id); onClose(); editor.focus()
	}
	const matches = query.trim() ? results : workspace.selectedPoint && connected ? [workspace.selectedPoint] : []
	return <div className="data-setup-dialog">
		<TldrawUiDialogHeader><TldrawUiDialogTitle>{shape ? 'Edit' : 'New'} {mode === 'table' ? 'table' : 'trend'}</TldrawUiDialogTitle><TldrawUiDialogCloseButton /></TldrawUiDialogHeader>
		<TldrawUiDialogBody>
			<div className="data-setup-steps"><button aria-current={step === 'points' ? 'step' : undefined} onClick={() => setStep('points')}>1 · Choose points</button><button disabled={!points.length} aria-current={step === 'layout' ? 'step' : undefined} onClick={() => setStep('layout')}>2 · {mode === 'table' ? 'Arrange table' : 'Chart settings'}</button></div>
			{!connected && <p role="status">{stationAlias ? `Connect to ${stationAlias} to find more points. Saved settings can still be edited.` : 'Connect to a station before adding a data shape.'}</p>}
			{step === 'points' ? <>
				<p>{mode === 'table' ? 'Pick matching points from similar equipment. Next, review the equipment rows and shared columns.' : 'Choose the points whose histories you want to compare.'}</p>
				<TldrawUiInput autoFocus value={query} onValueChange={setQuery} placeholder="Search points by name or path…" aria-label="Find data shape points" disabled={!connected} />
				<div className="data-setup-selection">
					<section><strong>{query.trim() ? 'Matches' : 'Inspected point'}</strong><div className="data-setup-matches">{matches.map((node) => <label key={node.ord}><input type="checkbox" checked={points.some((point) => point.pointReference === pointReference(node))} onChange={() => toggle(node)} /><span><strong>{nodeLabel(node)}</strong><small>{pointReference(node)}</small></span></label>)}</div><small role="status">{loading ? 'Searching…' : query && !results.length ? 'No matches.' : results.length >= 100 ? 'First 100 matches. Refine the search for more specific points.' : ''}</small></section>
					<section><strong>Selected · {points.length}</strong><div className="data-setup-matches">{points.map((point) => <div className="data-setup-selected" key={point.pointReference}><span><strong>{point.pointLabel}</strong><small>{point.equipmentLabel}</small></span><button aria-label={`Remove ${point.pointLabel} from ${point.equipmentLabel}`} onClick={() => setPoints((current) => current.filter((item) => item.pointReference !== point.pointReference))}>×</button></div>)}</div></section>
				</div>
			</> : <>
				<label className="binding-field"><span>Title</span><input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
				{mode === 'table' ? <>
					<p>{layout.rows.length} equipment rows · {layout.columns.length} columns. Rename headers in the preview. Empty cells have no point assigned.</p>
					<div className="data-setup-preview"><table><thead><tr><th>Equipment</th>{layout.columns.map(([key, label]) => <th key={key}><input aria-label={`Column name ${label}`} value={label} onChange={(event) => setPoints((current) => current.map((point) => point.fieldKey === key ? { ...point, fieldLabel: event.target.value } : point))} /></th>)}</tr></thead><tbody>{layout.rows.map(([key, label]) => <tr key={key}><th><input aria-label={`Equipment name ${label}`} value={label} onChange={(event) => setPoints((current) => current.map((point) => point.equipmentReference === key ? { ...point, equipmentLabel: event.target.value } : point))} /></th>{layout.columns.map(([column]) => {
						const cell = layout.cells.get(JSON.stringify([key, column])) || []
						return <td key={column} title={cell.map((point) => point.pointReference).join('\n')} data-conflict={cell.length > 1}>{cell.length > 1 ? 'Conflict' : cell.length ? cell[0].pointLabel : '—'}</td>
					})}</tr>)}</tbody></table></div>
					{layout.duplicates > 0 && <p role="alert">More than one point occupies {layout.duplicates} cell(s). Adjust assignments below before saving.</p>}
					<details className="data-setup-assignments"><summary>Point assignments · adjust rows and columns</summary>{points.map((point) => <div key={point.pointReference}><strong title={point.pointReference}>{point.pointLabel}</strong><label>Row<select aria-label={`Row for ${point.pointReference}`} value={point.equipmentReference} onChange={(event) => patch(point.pointReference, { equipmentReference: event.target.value, equipmentLabel: layout.rows.find(([key]) => key === event.target.value)![1] })}>{layout.rows.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Column<input aria-label={`Column for ${point.pointReference}`} value={point.fieldLabel} onChange={(event) => patch(point.pointReference, { fieldKey: event.target.value.trim().toLowerCase(), fieldLabel: event.target.value })} /></label></div>)}</details>
					<label className="bas-native-check"><input type="checkbox" checked={showStatus} onChange={(event) => setShowStatus(event.target.checked)} />Show point status</label>
				</> : <>
					<div className="mapping-grid"><label className="binding-field"><span>Time range</span><select value={rangeMs} onChange={(event) => setRangeMs(Number(event.target.value))}><option value={3_600_000}>1 hour</option><option value={21_600_000}>6 hours</option><option value={86_400_000}>24 hours</option><option value={604_800_000}>7 days</option><option value={2_592_000_000}>30 days</option></select></label><label className="binding-field"><span>Line</span><select value={lineMode} onChange={(event) => setLineMode(event.target.value)}><option value="line">Straight</option><option value="smooth">Smooth</option><option value="step">Stepped</option></select></label></div>
					{points.map((point, index) => <label className="data-setup-series" key={point.pointReference}><input type="color" aria-label={`${point.pointLabel} series color`} value={colors[point.pointReference] || trendColors[index % trendColors.length]} onChange={(event) => setColors((current) => ({ ...current, [point.pointReference]: event.target.value }))} /><span>{point.pointLabel}<small>{point.pointReference}</small></span></label>)}
					<p>Loads available Niagara history. Points without recorded history will have no line.</p>
				</>}
			</>}
			{error && <p role="alert">{error}</p>}
		</TldrawUiDialogBody>
		<TldrawUiDialogFooter><TldrawUiButton type="normal" onClick={onClose}><TldrawUiButtonLabel>Cancel</TldrawUiButtonLabel></TldrawUiButton>{step === 'points' ? <TldrawUiButton type="primary" disabled={!points.length} onClick={() => setStep('layout')}><TldrawUiButtonLabel>{mode === 'table' ? 'Review table' : 'Chart settings'}</TldrawUiButtonLabel></TldrawUiButton> : <><TldrawUiButton type="normal" onClick={() => setStep('points')}><TldrawUiButtonLabel>Back</TldrawUiButtonLabel></TldrawUiButton><TldrawUiButton type="primary" disabled={!stationAlias || !points.length || !title.trim() || points.some((point) => !point.fieldKey.trim() || !point.fieldLabel.trim() || !point.equipmentLabel.trim()) || (mode === 'table' && layout.duplicates > 0)} onClick={save}><TldrawUiButtonLabel>{shape ? 'Save changes' : `Create ${mode}`}</TldrawUiButtonLabel></TldrawUiButton></>}</TldrawUiDialogFooter>
	</div>
}
