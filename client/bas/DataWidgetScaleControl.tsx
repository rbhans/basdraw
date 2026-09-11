import { useState } from 'react'
import { useEditor, type TLShapeId } from 'tldraw'

export function DataWidgetScaleControl({ shapeId, scale = 1 }: { shapeId: TLShapeId; scale?: number }) {
	const editor = useEditor()
	const [draft, setDraft] = useState(String(Math.round(scale * 100)))
	const [error, setError] = useState('')
	const shape = editor.getShape(shapeId)
	const disabled = !shape || editor.getIsReadonly() || shape.isLocked || editor.getShapeAncestors(shape).some((ancestor) => ancestor.isLocked)
	const save = () => {
		if (disabled || !shape) return
		const value = Number(draft)
		if (!draft.trim() || !Number.isFinite(value) || value < 25 || value > 400) { setError('Use 25–400%.'); return }
		setError('')
		if (value / 100 === scale) return
		editor.markHistoryStoppingPoint('change widget content scale')
		if (shape.type === 'bas-table' || shape.type === 'bas-trend' || shape.type === 'bas-web-view') editor.updateShape({ id: shape.id, type: shape.type, props: { contentScale: value / 100 } })
	}
	return <>
		<label className="binding-field"><span>Content scale (%)</span><input type="number" min={25} max={400} step="any" value={draft} disabled={disabled} aria-invalid={Boolean(error)} onChange={(event) => { setDraft(event.target.value); setError('') }} onBlur={save} onKeyDown={(event) => {
			if (event.key === 'Enter') { event.stopPropagation(); event.currentTarget.blur() }
			if (event.key === 'Escape') { event.stopPropagation(); setDraft(String(Math.round(scale * 100))); setError('') }
		}} /></label>
		{error && <small role="alert">{error}</small>}
		<small>Scales text and details. Drag the handles to change the box's width and height.</small>
	</>
}
