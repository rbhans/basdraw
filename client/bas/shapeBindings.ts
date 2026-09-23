import type { Editor, JsonObject, RecordsDiff, TLRecord, TLShape, TLShapeId } from 'tldraw'
import type { BasDocumentAction, CanvasDocument, ShapeBinding } from './types'
import { migrateBinding, optionsMatchProperty } from './storage.ts'
import { behaviorConflict } from './behaviorDefinitions.ts'

function bindingEntries(shape: TLShape) {
	const values = Array.isArray(shape.meta.basBindings) ? shape.meta.basBindings : []
	const used = new Set<string>()
	return values.map((raw, index) => {
		const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
		const base = typeof value.key === 'string' ? value.key : typeof value.runtimeProperty === 'string' ? value.runtimeProperty : `unknown-${index}`
		let key = base, suffix = 2
		while (used.has(key)) key = `${base}-${suffix++}`
		used.add(key)
		const binding = migrateBinding({ ...value, id: `${shape.id}:${key}`, shapeId: shape.id })
		return { raw, value, key, binding }
	})
}

// Stable local keys follow clipboard copies; the owner prefix makes each copy independent.
export function bindingsFromShape(shape: TLShape) {
	return bindingEntries(shape).flatMap(({ binding }) => binding ? [binding] : [])
}

export function unsupportedBindingCount(shape: TLShape) {
	return bindingEntries(shape).filter(({ binding }) => !binding).length
}

export function readBindingDocument(editor: Editor): CanvasDocument {
	const alias = editor.getDocumentSettings().meta.basStationAlias
	return {
		version: 2,
		stationAlias: typeof alias === 'string' ? alias : null,
		bindings: editor.store.allRecords().flatMap((record) => record.typeName === 'shape' ? bindingsFromShape(record) : []),
	}
}

export function migrateLegacyBindings(editor: Editor, legacy: CanvasDocument) {
	if (editor.getDocumentSettings().meta.basBindingsVersion === 1) return
	editor.run(() => {
		for (const record of editor.store.allRecords()) {
			if (record.typeName !== 'shape' || Array.isArray(record.meta.basBindings)) continue
			const bindings = legacy.bindings.filter((binding) => binding.shapeId === record.id)
			if (bindings.length) writeEntries(editor, record, bindings.map(({ id: _id, shapeId: _shapeId, ...config }) => config))
		}
		editor.updateDocumentSettings({ meta: {
			...editor.getDocumentSettings().meta, basBindingsVersion: 1, basStationAlias: legacy.stationAlias,
		} })
	}, { history: 'ignore', ignoreShapeLock: true })
}

// Mutation boundary: validate first, write only the affected shape, and never
// reconstruct unrelated/unsupported entries from the lossy runtime projection.
export function dispatchShapeBindingAction(editor: Editor, action: BasDocumentAction): string | null {
	if (editor.getIsReadonly()) return 'This drawing is read-only.'
	if (action.type === 'set_station_alias') {
		editor.run(() => editor.updateDocumentSettings({ meta: {
			...editor.getDocumentSettings().meta, basStationAlias: action.stationAlias,
		} }), { history: 'ignore' })
		return null
	}
	const shape = action.type === 'create_binding'
		? editor.getShape(action.binding.shapeId as TLShapeId)
		: editor.store.allRecords().find((record): record is TLShape => record.typeName === 'shape' && bindingsFromShape(record).some((binding) => binding.id === action.bindingId))
	if (!shape) return 'The shape or behavior no longer exists.'
	if (shape.isLocked || editor.getShapeAncestors(shape).some((ancestor) => ancestor.isLocked)) return 'Unlock this shape to edit its behaviors.'
	const entries = bindingEntries(shape)
	const previous = action.type === 'create_binding' ? undefined : entries.find((entry) => entry.binding?.id === action.bindingId)
	let candidate: ShapeBinding | undefined
	if (action.type === 'create_binding') {
		const prefix = `${shape.id}:`
		const key = action.binding.id.startsWith(prefix) ? action.binding.id.slice(prefix.length) : action.binding.id
		if (!key || entries.some((entry) => entry.key === key)) return 'This behavior identity already exists.'
		candidate = { ...action.binding, id: `${prefix}${key}`, shapeId: shape.id }
	} else if (action.type === 'update_binding' && previous?.binding) {
		candidate = { ...previous.binding, ...action.patch, id: previous.binding.id, shapeId: shape.id }
	}
	// Changing the effect without new options must not carry the old effect's options (label settings on a rotation).
	if (candidate && !optionsMatchProperty(candidate.runtimeProperty, candidate.options)) candidate = { ...candidate, options: undefined }
	if (candidate) {
		const conflict = behaviorConflict(candidate, bindingsFromShape(shape))
		if (conflict) return conflict
	}
	let values: unknown[] = entries.map((entry) => entry.binding ? { ...entry.value, key: entry.key } : entry.raw)
	if (action.type === 'remove_binding') {
		values = values.filter((_, index) => entries[index] !== previous)
	} else if (candidate) {
		const { id, shapeId: _shapeId, ...config } = candidate
		const oldOptions = previous?.value.options
		const options = config.options && oldOptions && typeof oldOptions === 'object' && !Array.isArray(oldOptions) && oldOptions.kind === config.options.kind
			? { ...oldOptions, ...config.options } : config.options
		const value = { ...previous?.value, ...config, options, key: id.slice(shape.id.length + 1), schemaVersion: 1 }
		if (previous) values[entries.indexOf(previous)] = value
		else values.push(value)
	}
	editor.markHistoryStoppingPoint(action.type)
	writeEntries(editor, shape, values)
	return null
}

function writeEntries(editor: Editor, shape: TLShape, values: unknown[]) {
	const meta = JSON.parse(JSON.stringify({ ...shape.meta, basBindings: values })) as JsonObject
	editor.updateShape({ id: shape.id, type: shape.type, meta })
}

/**
 * True when a store change can alter the binding projection: shapes carrying bindings
 * were added or removed, a shape's `basBindings` changed, or the station alias changed.
 * Pointer moves, drags and resizes do not rebuild the projection.
 */
export function bindingDocumentChanged(changes: RecordsDiff<TLRecord>) {
	for (const record of Object.values(changes.added)) if (hasBindings(record)) return true
	for (const record of Object.values(changes.removed)) if (hasBindings(record)) return true
	for (const [from, to] of Object.values(changes.updated)) {
		if (to.typeName === 'shape' && from.typeName === 'shape' && from.meta.basBindings !== to.meta.basBindings) return true
		if (to.typeName === 'document' && from.typeName === 'document' && from.meta.basStationAlias !== to.meta.basStationAlias) return true
	}
	return false
}

function hasBindings(record: TLRecord) {
	return record.typeName === 'shape' && Array.isArray(record.meta.basBindings) && record.meta.basBindings.length > 0
}

/** Structural equality for JSON-like binding projections, without serializing either side. */
export function sameBindingDocument(a: CanvasDocument, b: CanvasDocument) {
	return a.stationAlias === b.stationAlias && a.bindings.length === b.bindings.length && a.bindings.every((binding, index) => jsonEqual(binding, b.bindings[index]))
}

function jsonEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true
	if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false
	const left = a as Record<string, unknown>, right = b as Record<string, unknown>
	const keys = Object.keys(left).filter((key) => left[key] !== undefined)
	if (keys.length !== Object.keys(right).filter((key) => right[key] !== undefined).length) return false
	return keys.every((key) => jsonEqual(left[key], right[key]))
}
