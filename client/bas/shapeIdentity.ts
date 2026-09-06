import type { Editor, JsonObject, TLShape, TLShapeId } from 'tldraw'

export type ShapeNavigation = { targetId: TLShapeId; targetName: string; framing: 'center' | 'fit'; enabled: boolean }

export function allNamedShapes(editor: Editor) {
	return editor.store.allRecords().filter((record): record is TLShape => record.typeName === 'shape')
}

export function shapeName(shape: TLShape): string {
	return typeof shape.meta.basName === 'string' && shape.meta.basName.trim() ? shape.meta.basName : shapeKind(shape)
}

function shapeKind(shape: TLShape) {
	if (shape.type === 'geo') {
		const props = shape.props as { geo: string; w: number; h: number }
		if (props.geo === 'rectangle' && Math.abs(props.w - props.h) < 1) return 'Square'
		return titleCase(props.geo)
	}
	return shape.type === 'bas-table' ? 'Table' : shape.type === 'bas-trend' ? 'Trend' : titleCase(shape.type)
}

function titleCase(value: string) { return value.replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) }

function nextName(base: string, used: Set<string>) {
	let index = 1
	while (used.has(`${base} ${index}`.toLowerCase())) index++
	return `${base} ${index}`
}

// Names are presentation metadata. Navigation always stores the immutable shape ID.
export function installShapeIdentities(editor: Editor) {
	const used = new Set(allNamedShapes(editor).filter((shape) => typeof shape.meta.basName === 'string').map((shape) => shapeName(shape).toLowerCase()))
	editor.run(() => {
		for (const shape of allNamedShapes(editor)) {
			if (typeof shape.meta.basName === 'string' && shape.meta.basName.trim()) continue
			const name = nextName(shapeKind(shape), used)
			used.add(name.toLowerCase())
			editor.updateShape({ id: shape.id, type: shape.type, meta: { ...shape.meta, basName: name } })
		}
	}, { history: 'ignore', ignoreShapeLock: true })
	return editor.sideEffects.registerBeforeCreateHandler('shape', (shape, source) => {
		const names = new Set(allNamedShapes(editor).map((item) => shapeName(item).toLowerCase()))
		const existing = typeof shape.meta.basName === 'string' ? shape.meta.basName.trim() : ''
		if (existing && (source !== 'user' || !names.has(existing.toLowerCase()))) return shape
		const name = nextName(existing ? `${existing} copy` : shapeKind(shape), names)
		return { ...shape, meta: { ...shape.meta, basName: name } }
	})
}

export function renameShape(editor: Editor, id: TLShapeId, value: string): string | null {
	const shape = editor.getShape(id), name = value.trim()
	if (!shape || shape.isLocked || editor.getIsReadonly()) return 'Unlock the shape to rename it.'
	if (!name) return 'Enter a shape name.'
	if (name.length > 100) return 'Keep the name under 100 characters.'
	if (allNamedShapes(editor).some((item) => item.id !== id && shapeName(item).toLowerCase() === name.toLowerCase())) return 'Another shape already uses this name.'
	if (shapeName(shape) !== name) {
		editor.markHistoryStoppingPoint('rename shape')
		editor.updateShape({ id, type: shape.type, meta: { ...shape.meta, basName: name } })
	}
	return null
}

export function shapeNavigation(shape: TLShape): ShapeNavigation | null {
	const value = shape.meta.basNavigation
	if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.targetId !== 'string' || !value.targetId.startsWith('shape:')) return null
	return { targetId: value.targetId as TLShapeId, targetName: typeof value.targetName === 'string' ? value.targetName : 'Destination', framing: value.framing === 'fit' ? 'fit' : 'center', enabled: value.enabled !== false }
}

export function saveNavigation(editor: Editor, id: TLShapeId, navigation: ShapeNavigation | null) {
	const shape = editor.getShape(id)
	if (!shape || shape.isLocked || editor.getIsReadonly()) return false
	if (navigation && (navigation.targetId === id || (!editor.getShape(navigation.targetId) && navigation.enabled))) return false
	const meta: JsonObject = { ...shape.meta }
	if (navigation) meta.basNavigation = { ...navigation }
	else delete meta.basNavigation
	editor.markHistoryStoppingPoint(navigation ? 'save navigation' : 'remove navigation')
	editor.updateShape({ id, type: shape.type, meta })
	return true
}

export function navigateToShape(editor: Editor, navigation: ShapeNavigation): boolean {
	const target = editor.getShape(navigation.targetId)
	const pageId = target && editor.getAncestorPageId(target)
	const bounds = target && editor.getShapePageBounds(target)
	if (!navigation.enabled || !target || !pageId || !bounds) return false
	const samePage = pageId === editor.getCurrentPageId()
	// Use the native camera lifecycle so a new navigation or user gesture can interrupt.
	// tldraw applies the user's animation-speed / reduced-motion preference.
	const cameraOptions = { immediate: true, ...(samePage ? { animation: { duration: 280 } } : {}) }
	editor.stopCameraAnimation()
	editor.setCurrentPage(pageId)
	editor.select(target.id)
	if (navigation.framing === 'fit') editor.zoomToBounds(bounds, { targetZoom: 1, inset: 80, ...cameraOptions })
	else editor.centerOnPoint(bounds.center, cameraOptions)
	editor.focus()
	return true
}
