import { resolveBehaviorChannels } from './behaviorDefinitions.ts'
import type { Editor, TLShape, TLShapeId } from 'tldraw'
import type { ShapeBinding } from './types'

export function pageVectorInShapeSpace(editor: Editor, shape: TLShape, vector?: { x: number; y: number }) {
	if (!vector) return { x: 0, y: 0 }
	const origin = editor.getPointInShapeSpace(shape, { x: 0, y: 0 })
	const destination = editor.getPointInShapeSpace(shape, vector)
	return { x: destination.x - origin.x, y: destination.y - origin.y }
}

export type BindingIndex = ReadonlyMap<string, readonly ShapeBinding[]>

const EMPTY_BINDINGS: readonly ShapeBinding[] = []

/** Group bindings by owning shape once per document change; renderers then look up in O(1). */
export function indexBindingsByShape(bindings: readonly ShapeBinding[]): BindingIndex {
	const index = new Map<string, ShapeBinding[]>()
	for (const binding of bindings) {
		const list = index.get(binding.shapeId)
		if (list) list.push(binding)
		else index.set(binding.shapeId, [binding])
	}
	return index
}

export function bindingsForShapeId(bindings: readonly ShapeBinding[] | BindingIndex, shapeId: string): readonly ShapeBinding[] {
	return isBindingIndex(bindings) ? bindings.get(shapeId) ?? EMPTY_BINDINGS : bindings.filter((binding) => binding.shapeId === shapeId)
}

/** Nearest owner first: the shape, then its enclosing groups from the innermost outwards. */
export function bindingsForRenderedShape(editor: Pick<Editor, 'getShapeAncestors'>, shape: TLShape, bindings: readonly ShapeBinding[] | BindingIndex) {
	// getShapeAncestors is ordered from the page root to the direct parent.
	const owners = [shape, ...editor.getShapeAncestors(shape).filter((ancestor) => ancestor.type === 'group').reverse()]
	return resolveBehaviorChannels(owners.flatMap((owner) => bindingsForShapeId(bindings, owner.id).filter((binding) => owner.id === shape.id || binding.runtimeProperty !== 'label')))
}

function isBindingIndex(value: readonly ShapeBinding[] | BindingIndex): value is BindingIndex {
	return value instanceof Map
}

export function transformOriginForBindings(
	editor: Editor,
	shape: TLShape,
	bindings: readonly ShapeBinding[],
	fallback: { x: number; y: number },
	property: 'rotation' | 'scale' = 'rotation',
) {
	const binding = resolveBehaviorChannels(bindings).find((item) => item.runtimeProperty === property)
	if (!binding) return fallback
	const owner = editor.getShape(binding.shapeId as TLShapeId)
	if (!owner) return fallback
	const bounds = editor.getShapeGeometry(owner).bounds
	const pivot = property === 'rotation' && binding.options?.kind === 'rotation' ? binding.options.pivot : undefined
	const local = { x: bounds.x + bounds.w * (pivot?.x ?? 0.5), y: bounds.y + bounds.h * (pivot?.y ?? 0.5) }
	return owner.id === shape.id ? local : editor.getPointInShapeSpace(shape, editor.getShapePageTransform(owner).applyToPoint(local))
}

export function groupLeafShapes(editor: Editor, group: TLShape) {
	const shapes: TLShape[] = []
	editor.visitDescendants(group, (id) => {
		const shape = editor.getShape(id)
		if (shape && shape.type !== 'group') shapes.push(shape)
	})
	return shapes
}
