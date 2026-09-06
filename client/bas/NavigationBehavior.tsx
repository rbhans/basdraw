import { useState } from 'react'
import { TldrawUiButton, TldrawUiButtonLabel, TldrawUiInput, useEditor, useValue, type TLShape, type TLShapeId } from 'tldraw'
import { allNamedShapes, navigateToShape, saveNavigation, shapeName, shapeNavigation } from './shapeIdentity'

export function NavigationBehavior({ shape, initiallyOpen = false, onDone }: { shape: TLShape; initiallyOpen?: boolean; onDone: () => void }) {
	const editor = useEditor()
	const saved = shapeNavigation(shape)
	const [open, setOpen] = useState(initiallyOpen)
	const [targetId, setTargetId] = useState(saved?.targetId || '')
	const [framing, setFraming] = useState<'center' | 'fit'>(saved?.framing || 'center')
	const [query, setQuery] = useState('')
	const [error, setError] = useState('')
	const shapes = useValue('navigation destinations', () => allNamedShapes(editor).filter((item) => item.id !== shape.id).sort((a, b) => shapeName(a).localeCompare(shapeName(b), undefined, { numeric: true })), [editor, shape.id])
	const target = shapes.find((item) => item.id === targetId)
	const locked = shape.isLocked || editor.getIsReadonly()
	const close = () => { setOpen(false); setTargetId(saved?.targetId || ''); setFraming(saved?.framing || 'center'); setQuery(''); setError(''); onDone() }
	return <div className="behavior-item bas-navigation-behavior">
		{saved && <div className="behavior-item-heading"><button className="behavior-expand" aria-expanded={open} onClick={() => setOpen((value) => !value)}><span aria-hidden="true">{open ? '⌄' : '›'}</span><span><strong>Navigate</strong><small>{shapes.find((item) => item.id === saved.targetId) ? shapeName(shapes.find((item) => item.id === saved.targetId)!) : `${saved.targetName} · missing`}</small></span></button><input type="checkbox" role="switch" aria-label="Enable navigation" checked={saved.enabled} disabled={locked} onChange={(event) => saveNavigation(editor, shape.id, { ...saved, enabled: event.target.checked })} /></div>}
		{open && <div className="behavior-editor">
			<strong>{saved ? 'Navigation' : 'Add navigation'}</strong>
			<p>Jump to another shape, even on another page. No station point required.</p>
			<fieldset className="behavior-editor-fieldset" disabled={locked}>
				<label className="binding-field"><span>Destination</span><select aria-label="Navigation destination" value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">Choose a shape…</option>{targetId && !target && <option value={targetId}>{saved?.targetName || 'Destination'} · missing</option>}{shapes.map((item) => <option key={item.id} value={item.id}>{shapeName(item)} · {editor.getPage(editor.getAncestorPageId(item)!)?.name}</option>)}</select></label>
				<TldrawUiInput aria-label="Find navigation destination" value={query} onValueChange={setQuery} placeholder="Find a shape by name…" />
				{query.trim() && <div className="bas-navigation-matches">{shapes.filter((item) => shapeName(item).toLowerCase().includes(query.trim().toLowerCase())).slice(0, 20).map((item) => <TldrawUiButton type="normal" key={item.id} onClick={() => { setTargetId(item.id); setQuery('') }}><TldrawUiButtonLabel>{shapeName(item)}</TldrawUiButtonLabel></TldrawUiButton>)}</div>}
				<label className="binding-field"><span>Camera</span><select aria-label="Navigation camera" value={framing} onChange={(event) => setFraming(event.target.value as 'center' | 'fit')}><option value="center">Center · keep zoom</option><option value="fit">Fit destination</option></select></label>
				{targetId && !target && <p role="alert">The destination was deleted. Choose another shape or undo its deletion.</p>}
				<p>Select the linked shape, then use its Go button. Normal clicks still select and edit.</p>
				<div className="bas-navigation-actions"><TldrawUiButton type="normal" onClick={close}><TldrawUiButtonLabel>Cancel</TldrawUiButtonLabel></TldrawUiButton><TldrawUiButton type="primary" disabled={!target} onClick={() => {
					if (target && saveNavigation(editor, shape.id, { targetId: target.id as TLShapeId, targetName: shapeName(target), framing, enabled: saved?.enabled ?? true })) close()
					else setError('The shape or destination changed. Select it again.')
				}}><TldrawUiButtonLabel>{saved ? 'Save changes' : 'Add navigation'}</TldrawUiButtonLabel></TldrawUiButton></div>
			</fieldset>
			{saved && <TldrawUiButton type="danger" disabled={locked} onClick={() => { saveNavigation(editor, shape.id, null); onDone() }}><TldrawUiButtonLabel>Remove navigation</TldrawUiButtonLabel></TldrawUiButton>}
			{error && <small role="alert">{error}</small>}
		</div>}
		{saved && <TldrawUiButton type="normal" disabled={!saved.enabled || !editor.getShape(saved.targetId)} onClick={() => navigateToShape(editor, saved)}><TldrawUiButtonLabel>Go to {editor.getShape(saved.targetId) ? shapeName(editor.getShape(saved.targetId)!) : saved.targetName} ↗</TldrawUiButtonLabel></TldrawUiButton>}
	</div>
}
