import { resolveBehaviorChannels } from './behaviorDefinitions'
import type { Editor, TLShape, TLShapeId } from 'tldraw'
import type { ShapeBinding } from './types'

export function pageVectorInShapeSpace(editor: Editor, shape: TLShape, vector?: { x: number; y: number }) {
	if (!vector) return { x: 0, y: 0 }
	const origin = editor.getPointInShapeSpace(shape, { x: 0, y: 0 })
	const destination = editor.getPointInShapeSpace(shape, vector)
	return { x: destination.x - origin.x, y: destination.y - origin.y }
}

export function bindingsForRenderedShape(editor: Editor, shape: TLShape, bindings: ShapeBinding[]) {
	const owners = [shape, ...editor.getShapeAncestors(shape).filter((ancestor) => ancestor.type === 'group').sort((a, b) => editor.getShapeAncestors(b).length - editor.getShapeAncestors(a).length)]
	return resolveBehaviorChannels(owners.flatMap((owner) => bindings.filter((binding) => binding.shapeId === owner.id && (owner.id === shape.id || binding.runtimeProperty !== 'label'))))
}

export function transformOriginForBindings(
	editor: Editor,
	shape: TLShape,
	bindings: ShapeBinding[],
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
