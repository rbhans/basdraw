import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PointSnapshotStore } from '../client/bas/pointSnapshotStore.ts'
import { bindingsForRenderedShape, indexBindingsByShape } from '../client/bas/bindingScope.ts'
import { bindingDocumentChanged, dispatchShapeBindingAction, readBindingDocument, sameBindingDocument } from '../client/bas/shapeBindings.ts'
import { migrateBinding } from '../client/bas/storage.ts'
import { getRuntimeShapePresentation } from '../client/bas/runtimeMapping.ts'

const binding = (id, shapeId, runtimeProperty, point = `point:${id}`, extra = {}) => ({
	id, shapeId, runtimeProperty, pointReference: point, pointLabel: point, stationAlias: 'station', mapping: { kind: 'auto' }, ...extra,
})

test('snapshot store wakes only subscribers of changed points, once per batch', () => {
	const store = new PointSnapshotStore()
	let a = 0, b = 0, both = 0
	store.subscribe('a', () => a++)
	store.subscribe('b', () => b++)
	const bothListener = () => both++
	store.subscribe('a', bothListener)
	store.subscribe('b', bothListener)
	store.ingest([{ point: 'a', value: 1 }])
	assert.deepEqual([a, b, both], [1, 0, 1])
	store.ingest([{ point: 'a', value: 2 }, { point: 'b', value: 3 }])
	assert.deepEqual([a, b, both], [2, 1, 2], 'a listener on two changed points is woken once')
	store.ingest([{ point: 'a', value: 2 }])
	assert.equal(a, 2, 'identical COV repeats do not notify')
	store.ingest([{ point: 'a', status: 'alarm' }])
	assert.deepEqual(store.get('a'), { point: 'a', value: 2, status: 'alarm' }, 'partial pushes merge')
})

test('snapshot store versions, pick, clear and unsubscribe', () => {
	const store = new PointSnapshotStore()
	let calls = 0
	const stop = store.subscribe('x', () => calls++)
	store.ingest([{ point: 'x', value: true }, { point: 'y', value: false }, null, { value: 'no point' }])
	const version = store.version('x')
	assert.ok(version > 0)
	assert.deepEqual(Object.keys(store.pick(['x', 'missing'])), ['x'])
	store.clear()
	assert.equal(store.get('x'), undefined)
	assert.ok(store.version('x') > version, 'clearing changes the version so cached readers refresh')
	assert.equal(calls, 2)
	stop()
	assert.equal(store.subscribedPointCount, 0)
	store.ingest([{ point: 'x', value: 1 }])
	assert.equal(calls, 2)
	store.replaceAll({ z: { point: 'z', value: 1 } })
	assert.deepEqual(Object.keys(store.pick(['x', 'z'])), ['z'])
})

test('bindings-by-shape index matches the list scan, including group inheritance', () => {
	const bindings = [
		binding('label', 'shape:child', 'label'),
		binding('child-rotate', 'shape:child', 'rotation'),
		binding('inner-rotate', 'shape:inner', 'rotation'),
		binding('inner-scale', 'shape:inner', 'scale'),
		binding('outer-scale', 'shape:outer', 'scale'),
		binding('outer-label', 'shape:outer', 'label'),
		binding('other', 'shape:other', 'opacity'),
	]
	const index = indexBindingsByShape(bindings)
	assert.equal(index.get('shape:child').length, 2)
	assert.equal(index.get('shape:missing'), undefined)
	const shapes = {
		'shape:outer': { id: 'shape:outer', type: 'group' },
		'shape:inner': { id: 'shape:inner', type: 'group' },
		'shape:frame': { id: 'shape:frame', type: 'frame' },
	}
	// Root first, as tldraw orders ancestors.
	const editor = { getShapeAncestors: () => [shapes['shape:outer'], shapes['shape:frame'], shapes['shape:inner']] }
	const child = { id: 'shape:child', type: 'geo' }
	const fromIndex = bindingsForRenderedShape(editor, child, index).map((item) => item.id)
	assert.deepEqual(fromIndex, bindingsForRenderedShape(editor, child, bindings).map((item) => item.id))
	// Nearest owner wins each channel; ancestor labels are not inherited.
	assert.deepEqual(fromIndex, ['label', 'child-rotate', 'inner-scale'])
})

test('presentation motions keep a stable x-then-y order for the fixed wrapper slots', () => {
	const motion = (id, axis) => binding(id, 'shape:a', 'movement', `p:${id}`, { options: { kind: 'movement', mode: 'travel', axis, direction: 'positive', distance: 10, secondsPerCycle: 2 } })
	const snapshots = { 'p:y': { point: 'p:y', value: true }, 'p:x': { point: 'p:x', value: true } }
	const presentation = getRuntimeShapePresentation([motion('y', 'y'), motion('x', 'x')], snapshots)
	assert.deepEqual(presentation.motions.map((item) => item.id), ['x', 'y'])
	assert.equal('motion' in presentation, false)
})

function fakeEditor(shapes) {
	const records = new Map(shapes.map((shape) => [shape.id, shape]))
	return {
		records,
		getIsReadonly: () => false,
		getShape: (id) => records.get(id),
		getShapeAncestors: () => [],
		markHistoryStoppingPoint: () => {},
		updateShape: (partial) => records.set(partial.id, { ...records.get(partial.id), ...partial }),
		getDocumentSettings: () => ({ meta: { basStationAlias: 'station' } }),
		store: { allRecords: () => [...records.values()] },
	}
}

test('changing an effect drops options that belong to the previous effect', () => {
	const label = { kind: 'label', placement: 'top', gap: 4 }
	const editor = fakeEditor([{ id: 'shape:a', typeName: 'shape', type: 'geo', isLocked: false, meta: { basBindings: [{ key: 'k', schemaVersion: 1, stationAlias: 'station', pointReference: 'p', pointLabel: 'P', runtimeProperty: 'label', mapping: { kind: 'auto' }, options: label, extra: 'kept' }] } }])
	assert.equal(dispatchShapeBindingAction(editor, { type: 'update_binding', bindingId: 'shape:a:k', patch: { runtimeProperty: 'rotation' } }), null)
	const [saved] = editor.records.get('shape:a').meta.basBindings
	assert.equal(saved.runtimeProperty, 'rotation')
	assert.equal('options' in saved, false, 'label options are not kept on a rotation')
	assert.equal(saved.extra, 'kept', 'unknown fields survive the edit')
	const rotation = { kind: 'rotation', mode: 'spin', secondsPerTurn: 2, direction: 'clockwise', restAngle: 0 }
	assert.equal(dispatchShapeBindingAction(editor, { type: 'update_binding', bindingId: 'shape:a:k', patch: { options: rotation } }), null)
	assert.deepEqual(editor.records.get('shape:a').meta.basBindings[0].options, rotation, 'matching options are saved')
	// Legacy saved data with a mismatched kind is not projected into the runtime.
	assert.equal(migrateBinding({ id: 'x', shapeId: 's', stationAlias: 'a', pointReference: 'p', pointLabel: 'p', runtimeProperty: 'scale', options: label }).options, undefined)
})

test('binding projection rebuilds only for binding-relevant store changes', () => {
	const shape = (meta, extra = {}) => ({ id: 'shape:a', typeName: 'shape', type: 'geo', x: 0, meta, ...extra })
	const bindings = [{ key: 'k' }]
	const before = shape({ basBindings: bindings })
	const diff = (patch) => ({ added: {}, removed: {}, updated: {}, ...patch })
	assert.equal(bindingDocumentChanged(diff({ updated: { a: [before, { ...before, x: 10 }] } })), false, 'a drag frame is ignored')
	assert.equal(bindingDocumentChanged(diff({ updated: { a: [before, shape({ basBindings: [{ key: 'k' }] })] } })), true)
	assert.equal(bindingDocumentChanged(diff({ added: { b: shape({}) } })), false, 'shapes without bindings do not matter')
	assert.equal(bindingDocumentChanged(diff({ removed: { a: before } })), true)
	const document = (alias) => ({ id: 'document:document', typeName: 'document', meta: { basStationAlias: alias } })
	assert.equal(bindingDocumentChanged(diff({ updated: { d: [document('a'), document('b')] } })), true)
	const editor = fakeEditor([shape({ basBindings: [{ key: 'k', schemaVersion: 1, stationAlias: 'station', pointReference: 'p', pointLabel: 'P', runtimeProperty: 'label', mapping: { kind: 'auto' } }] })])
	assert.ok(sameBindingDocument(readBindingDocument(editor), readBindingDocument(editor)))
})
