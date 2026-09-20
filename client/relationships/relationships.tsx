import { useState } from 'react'
import {
	createShapeId,
	toRichText,
	TldrawUiButton,
	TldrawUiButtonLabel,
	TldrawUiInput,
	useEditor,
	useToasts,
	type Editor,
	type JsonObject,
	type JsonValue,
	type TLArrowShape,
	type TLShape,
	type TLShapeId,
} from 'tldraw'
import type { BasdrawAgentCanvasCapability } from '../plugins/types'

type BasRelationship = { kind: string; label: string; fromShapeId: string; toShapeId: string }

export function readRelationship(shape: TLShape): BasRelationship | null {
	const value = shape.meta.basRelationship
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null
	if (typeof value.kind !== 'string' || typeof value.label !== 'string' || typeof value.fromShapeId !== 'string' || typeof value.toShapeId !== 'string') return null
	return { kind: value.kind, label: value.label, fromShapeId: value.fromShapeId, toShapeId: value.toShapeId }
}

export function createRelationship(editor: Editor, fromShapeId: string, toShapeId: string, kind = 'related', label = '') {
	if (editor.getIsReadonly()) throw new Error('This drawing is read-only.')
	const from = requiredShape(editor, fromShapeId)
	const to = requiredShape(editor, toShapeId)
	if (from.id === to.id) throw new Error('Choose two different shapes for a relationship.')
	const start = editor.getShapePageBounds(from)?.center
	const end = editor.getShapePageBounds(to)?.center
	if (!start || !end) throw new Error('Both relationship shapes need visible bounds.')
	const id = createShapeId()
	const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y)
	const relation = normalizeRelationship({ kind, label, fromShapeId: from.id, toShapeId: to.id })
	const defaults = editor.getShapeUtil<TLArrowShape>('arrow').getDefaultProps()
	editor.markHistoryStoppingPoint('create relationship')
	editor.createShape<TLArrowShape>({
		id, type: 'arrow', x, y,
		props: { ...defaults, start: { x: start.x - x, y: start.y - y }, end: { x: end.x - x, y: end.y - y }, richText: toRichText(relation.label) },
		meta: { basRelationship: relation } as JsonObject,
	})
	for (const [target, terminal] of [[from, 'start'], [to, 'end']] as const) {
		editor.createBinding({ type: 'arrow', fromId: id, toId: target.id, props: { terminal, normalizedAnchor: { x: .5, y: .5 }, isExact: false, isPrecise: false, snap: 'none' }, meta: {} })
	}
	return id
}

export function updateRelationship(editor: Editor, shapeId: string, change: Partial<Pick<BasRelationship, 'kind' | 'label'>>) {
	const shape = requiredShape(editor, shapeId)
	const current = readRelationship(shape)
	if (shape.type !== 'arrow' || !current) throw new Error(`${shapeId} is not a relationship arrow.`)
	if (shape.isLocked || editor.getShapeAncestors(shape).some((ancestor) => ancestor.isLocked) || editor.getIsReadonly()) throw new Error('Unlock the relationship to edit it.')
	const next = normalizeRelationship({ ...current, ...change })
	editor.markHistoryStoppingPoint('update relationship')
	editor.updateShape<TLArrowShape>({ id: shape.id, type: 'arrow', props: { richText: toRichText(next.label) }, meta: { ...shape.meta, basRelationship: next } })
	return shape.id
}

export function useCreateRelationship() {
	const editor = useEditor()
	const { addToast } = useToasts()
	return () => {
		const shapes = editor.getSelectedShapes()
		if (shapes.length !== 2) {
			addToast({ title: 'Select two shapes', description: 'The first selected shape will point to the second.', severity: 'info' })
			return
		}
		try { editor.select(createRelationship(editor, shapes[0].id, shapes[1].id)); editor.focus() }
		catch (cause) { addToast({ title: 'Could not create relationship', description: cause instanceof Error ? cause.message : String(cause), severity: 'error' }) }
	}
}

export function RelationshipProperties({ shape }: { shape: TLShape }) {
	const editor = useEditor()
	const relation = readRelationship(shape)!
	const [kind, setKind] = useState(relation.kind)
	const [label, setLabel] = useState(relation.label)
	const [error, setError] = useState('')
	const locked = shape.isLocked || editor.getShapeAncestors(shape).some((ancestor) => ancestor.isLocked) || editor.getIsReadonly()
	const save = () => {
		try { updateRelationship(editor, shape.id, { kind, label }); setError('') }
		catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
	}
	return <section className="bas-native-settings" aria-label="Relationship settings">
		<strong>Relationship</strong>
		<label><span>Type</span><TldrawUiInput value={kind} onValueChange={setKind} onComplete={save} disabled={locked} /></label>
		<label><span>Label</span><TldrawUiInput value={label} onValueChange={setLabel} onComplete={save} disabled={locked} /></label>
		<TldrawUiButton type="primary" disabled={locked || (kind === relation.kind && label === relation.label)} onClick={save}><TldrawUiButtonLabel>Save relationship</TldrawUiButtonLabel></TldrawUiButton>
		<small>{simpleId(relation.fromShapeId)} → {simpleId(relation.toShapeId)}</small>
		{error && <small role="alert">{error}</small>}
	</section>
}

export const relationshipAgentCapabilities: readonly BasdrawAgentCanvasCapability[] = [{
	id: 'relationship', title: 'Canvas relationship',
	description: 'Connect two existing canvas items with a native bound tldraw arrow carrying relationship metadata.',
	operations: ['create', 'update', 'delete'],
	inputSchema: { fromShapeId: 'Required for create.', toShapeId: 'Required for create.', kind: 'Short relationship type such as feeds, controls, documents or related.', label: 'Optional visible arrow label.' },
	inspect: (_editor, shape) => {
		const relation = readRelationship(shape)
		return relation ? relation as unknown as JsonValue : null
	},
	execute: ({ editor, operation, shapeId, arguments: args }) => {
		if (operation === 'create') {
			const id = createRelationship(editor, text(args.fromShapeId, 'fromShapeId'), text(args.toShapeId, 'toShapeId'), optionalText(args.kind, 'related'), optionalText(args.label, ''))
			return { shapeId: simpleId(id), type: 'relationship' }
		}
		if (!shapeId) throw new Error('shapeId is required for update or delete.')
		if (operation === 'delete') {
			const shape = requiredShape(editor, shapeId)
			if (!readRelationship(shape)) throw new Error(`${shapeId} is not a relationship arrow.`)
			if (shape.isLocked || editor.getShapeAncestors(shape).some((ancestor) => ancestor.isLocked)) throw new Error('Unlock the relationship to delete it.')
			editor.markHistoryStoppingPoint('delete relationship')
			editor.deleteShape(shape.id)
			return { removed: simpleId(shape.id) }
		}
		const id = updateRelationship(editor, shapeId, { ...(args.kind !== undefined ? { kind: text(args.kind, 'kind') } : {}), ...(args.label !== undefined ? { label: optionalText(args.label, '') } : {}) })
		return { shapeId: simpleId(id) }
	},
}]

function requiredShape(editor: Editor, id: string) {
	const shape = editor.getShape(fullId(id))
	if (!shape) throw new Error(`Shape ${id} does not exist.`)
	return shape
}
function normalizeRelationship(value: BasRelationship): BasRelationship {
	const kind = value.kind.trim().slice(0, 80)
	if (!kind) throw new Error('Relationship type is required.')
	return { ...value, kind, label: value.label.trim().slice(0, 160) }
}
function fullId(id: string): TLShapeId { return (id.startsWith('shape:') ? id : `shape:${id}`) as TLShapeId }
function simpleId(id: string) { return id.startsWith('shape:') ? id.slice(6) : id }
function text(value: JsonValue | undefined, field: string) { if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`); return value.trim() }
function optionalText(value: JsonValue | undefined, fallback: string) { return typeof value === 'string' ? value.trim() : fallback }
