// Development-only browser regression fixture. No persisted store or station.
import { pageVectorInShapeSpace, transformOriginForBindings } from './bindingScope'
import { migrateBinding } from './storage'
import { labelStacks } from './RuntimeValueLabels'
import { pointType } from './pointType'
import { containerKind } from './containerKind'
import { dataWidgetContentStyle } from './dataWidgetSizing'
import { bindingsForRenderedShape } from './bindingScope'
import { unsupportedBindingCount } from './shapeBindings'
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { Tldraw, PageRecordType, createShapeId, getSnapshot, loadSnapshot, type Editor, type JsonObject } from 'tldraw'
import 'tldraw/tldraw.css'
import { bindingsFromShape, dispatchShapeBindingAction, migrateLegacyBindings, readBindingDocument } from './shapeBindings'
import type { ShapeBinding } from './types'
import { getRuntimeShapePresentation } from './runtimeMapping'
import { tableLayout, toDataWidgetPoint } from './dataShapeSetup'
import { allNamedShapes, installShapeIdentities, navigateToShape, renameShape, saveNavigation, shapeName, shapeNavigation } from './shapeIdentity'

function Fixture() {
	const [results, setResults] = useState<string[]>([])
	function run(editor: Editor) {
		const results: string[] = []
		const check = (name: string, test: () => void) => {
			try { test(); results.push(`PASS: ${name}`) }
			catch (error) { results.push(`FAIL: ${name}: ${String(error)}`) }
		}
		const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }
		const id = createShapeId('regression-source')
		editor.createShape({ id, type: 'geo' })
		const binding: ShapeBinding = { id: 'legacy-id', shapeId: id, stationAlias: 'test-station', pointReference: 'slot:/AHU/points/temp', pointLabel: 'Temperature', runtimeProperty: 'label', mapping: { kind: 'auto' } }
		check('Legacy migration preserves bindings and unrelated metadata', () => {
			editor.updateShape({ id, type: 'geo', meta: { owner: 'fixture' } })
			migrateLegacyBindings(editor, { version: 2, stationAlias: 'test-station', bindings: [binding] })
			assert(readBindingDocument(editor).bindings.length === 1, 'Missing migrated binding')
			assert(editor.getShape(id)?.meta.owner === 'fixture', 'Other metadata changed')
		})
		editor.clearHistory()
		check('Binding edits undo and redo as one native step', () => {
			dispatchShapeBindingAction(editor, { type: 'update_binding', bindingId: `${id}:label`, patch: { pointReference: 'slot:/AHU/points/setpoint' } })
			assert(readBindingDocument(editor).bindings[0].pointReference.endsWith('setpoint'), 'Update failed')
			editor.undo()
			assert(readBindingDocument(editor).bindings[0].pointReference.endsWith('temp'), 'Undo failed')
			editor.redo()
			assert(readBindingDocument(editor).bindings[0].pointReference.endsWith('setpoint'), 'Redo failed')
		})
		check('Duplicating a shape carries independent point bindings', () => {
			editor.markHistoryStoppingPoint('duplicate fixture')
			editor.duplicateShapes([id], { x: 150, y: 0 })
			const duplicate = editor.getCurrentPageShapes().find((shape) => shape.id !== id)!
			const copied = bindingsFromShape(duplicate)[0]
			assert(copied.shapeId === duplicate.id && copied.id !== `${id}:label`, 'Copied binding targets original')
			dispatchShapeBindingAction(editor, { type: 'update_binding', bindingId: copied.id, patch: { pointLabel: 'Copy only' } })
			assert(bindingsFromShape(editor.getShape(id)!)[0].pointLabel === 'Temperature', 'Original was changed')
		})
		check('Delete removes bindings and undo restores them', () => {
			editor.markHistoryStoppingPoint('delete fixture')
			editor.deleteShapes([id])
			assert(!readBindingDocument(editor).bindings.some((item) => item.shapeId === id), 'Orphan binding retained')
			editor.undo()
			assert(bindingsFromShape(editor.getShape(id)!).length === 1, 'Undo lost binding')
		})
		check('Removed bindings stay removed after migration is revisited', () => {
			dispatchShapeBindingAction(editor, { type: 'remove_binding', bindingId: `${id}:label` })
			migrateLegacyBindings(editor, { version: 2, stationAlias: 'test-station', bindings: [binding] })
			assert(bindingsFromShape(editor.getShape(id)!).length === 0, 'Legacy binding resurrected')
			editor.undo()
		})
		check('Snapshot reload preserves the binding document', () => {
			const before = JSON.stringify(readBindingDocument(editor))
			const snapshot = getSnapshot(editor.store)
			loadSnapshot(editor.store, snapshot)
			assert(JSON.stringify(readBindingDocument(editor)) === before, 'Snapshot changed bindings')
		})
		check('Native clipboard content includes binding metadata', () => {
			const content = editor.getContentFromCurrentPage([id])
			assert(content?.shapes[0].meta.basBindings, 'Clipboard omitted metadata')
		})
		check('Changing a driver preserves animation settings and is undoable', () => {
			const motion: ShapeBinding = { ...binding, id: `${id}:rotation`, runtimeProperty: 'rotation', mapping: { kind: 'boolean', falseValue: 0, trueValue: 1 }, options: { kind: 'rotation', mode: 'spin', secondsPerTurn: 3, direction: 'counterclockwise', restAngle: 25 } }
			dispatchShapeBindingAction(editor, { type: 'create_binding', binding: motion })
			dispatchShapeBindingAction(editor, { type: 'update_binding', bindingId: `${id}:rotation`, patch: { pointReference: 'slot:/new/fan', pointLabel: 'New fan' } })
			const updated = readBindingDocument(editor).bindings.find((item) => item.id === `${id}:rotation`)!
			assert(updated.pointReference === 'slot:/new/fan', 'Driver not replaced')
			assert(JSON.stringify(updated.mapping) === JSON.stringify(motion.mapping) && JSON.stringify(updated.options) === JSON.stringify(motion.options), 'Settings changed with driver')
			editor.undo()
			assert(readBindingDocument(editor).bindings.find((item) => item.id === `${id}:rotation`)?.pointReference === motion.pointReference, 'Driver undo failed')
		})
		check('Disabled behavior retains its configuration through save and undo', () => {
			dispatchShapeBindingAction(editor, { type: 'update_binding', bindingId: `${id}:rotation`, patch: { enabled: false } })
			const before = readBindingDocument(editor).bindings.find((item) => item.id === `${id}:rotation`)!
			loadSnapshot(editor.store, getSnapshot(editor.store))
			const after = readBindingDocument(editor).bindings.find((item) => item.id === `${id}:rotation`)!
			assert(after.enabled === false && JSON.stringify(before) === JSON.stringify(after), 'Disabled settings not persisted')
			editor.undo()
			assert(readBindingDocument(editor).bindings.find((item) => item.id === `${id}:rotation`)?.enabled !== false, 'Enable undo failed')
		})
		check('Disabled motion does not affect runtime presentation', () => {
			const motion = readBindingDocument(editor).bindings.find((item) => item.id === `${id}:rotation`)!
			const snapshots = { [motion.pointReference]: { point: motion.pointReference, value: true } }
			const active = getRuntimeShapePresentation([motion], snapshots)
			const disabled = getRuntimeShapePresentation([{ ...motion, enabled: false }], snapshots)
			assert(JSON.stringify(active) !== JSON.stringify(disabled), 'Disabled motion still active')
		})
		check('Value background settings survive snapshot reload', () => {
			dispatchShapeBindingAction(editor, { type: 'update_binding', bindingId: `${id}:label`, patch: { options: { kind: 'label', placement: 'right', gap: 8, background: 'none', cornerRadius: 3, colorMode: 'custom', color: '#4263eb' } } })
			loadSnapshot(editor.store, getSnapshot(editor.store))
			const options = bindingsFromShape(editor.getShape(id)!).find((item) => item.runtimeProperty === 'label')?.options
			assert(options?.kind === 'label' && options.background === 'none' && options.cornerRadius === 3, 'Label appearance lost')
		})
		check('Table setup groups equipment and detects conflicting assignments', () => {
			const first = toDataWidgetPoint({ ord: 'slot:/AHU_01/points/temp', display: 'Temperature' })
			const second = toDataWidgetPoint({ ord: 'slot:/AHU_02/points/temp', display: 'Temperature' })
			const layout = tableLayout([first, second])
			assert(layout.rows.length === 2 && layout.columns.length === 1 && layout.missing === 0, 'Incorrect inferred layout')
			const conflict = tableLayout([first, { ...second, equipmentReference: first.equipmentReference }])
			assert(conflict.duplicates === 1, 'Conflicting points were silently lost')
		})
		const stopIdentities = installShapeIdentities(editor)
		const destination = createShapeId('navigation-destination')
		check('Shape names are unique on creation and duplication', () => {
			editor.createShapes([{ id: destination, type: 'geo', x: 2200, y: 1400 }, { id: createShapeId('second-square'), type: 'geo' }])
			const before = shapeName(editor.getShape(destination)!)
			editor.duplicateShapes([destination], { x: 200, y: 0 })
			const names = allNamedShapes(editor).map((shape) => shapeName(shape).toLowerCase())
			assert(new Set(names).size === names.length, 'Duplicate names generated')
			assert(shapeName(editor.getShape(destination)!) === before, 'Original name changed')
		})
		check('Renaming preserves metadata, rejects duplicate names and supports undo', () => {
			const original = shapeName(editor.getShape(destination)!)
			assert(renameShape(editor, destination, 'Mechanical room') === null, 'Rename rejected')
			assert(renameShape(editor, id, 'Mechanical room') !== null, 'Duplicate name accepted')
			editor.undo()
			assert(shapeName(editor.getShape(destination)!) === original, 'Name undo failed')
			assert(bindingsFromShape(editor.getShape(id)!).length > 0, 'Bindings lost')
		})
		check('Navigation follows destination identity after move and rename', () => {
			assert(saveNavigation(editor, id, { targetId: destination, targetName: shapeName(editor.getShape(destination)!), framing: 'center', enabled: true }), 'Navigation not saved')
			renameShape(editor, destination, 'Renamed destination')
			editor.updateShape({ id: destination, type: 'geo', x: 3200, y: 2400 })
			const nav = shapeNavigation(editor.getShape(id)!)!
			assert(nav.targetId === destination && navigateToShape(editor, nav), 'Stable destination lost')
			const targetCenter = editor.getShapePageBounds(destination)!.center
			if (editor.user.getAnimationSpeed() > 0) {
				const start = editor.getViewportPageBounds().center.clone()
				assert(Math.abs(start.x - targetCenter.x) > 1, 'Same-page navigation jumped immediately')
				editor.emit('tick', 140 / editor.user.getAnimationSpeed())
				const middle = editor.getViewportPageBounds().center
				assert(Math.abs(middle.x - start.x) > 1 && Math.abs(middle.x - targetCenter.x) > 1, 'No intermediate pan position')
			}
			editor.emit('tick', 10000)
			const center = editor.getViewportPageBounds().center, bounds = editor.getShapePageBounds(destination)!
			assert(Math.abs(center.x - bounds.center.x) < 1 && Math.abs(center.y - bounds.center.y) < 1, 'Camera did not center destination')
		})
		check('Deleted navigation destinations fail safely and recover on undo', () => {
			const nav = shapeNavigation(editor.getShape(id)!)!
			editor.markHistoryStoppingPoint('delete destination')
			editor.deleteShapes([destination])
			assert(!navigateToShape(editor, nav), 'Missing destination navigated')
			editor.undo()
			assert(navigateToShape(editor, nav), 'Undo did not restore target')
			assert(!navigateToShape(editor, { ...nav, enabled: false }), 'Disabled navigation followed')
		})
		check('Navigation and names persist and support cross-page destinations', () => {
			const pageId = PageRecordType.createId('navigation-page')
			editor.createPage({ id: pageId, name: 'Destination page' })
			editor.moveShapesToPage([destination], pageId)
			const before = shapeNavigation(editor.getShape(id)!)!
			loadSnapshot(editor.store, getSnapshot(editor.store))
			assert(shapeName(editor.getShape(destination)!) === 'Renamed destination', 'Name not persisted')
			const nav = shapeNavigation(editor.getShape(id)!)!
			assert(JSON.stringify(nav) === JSON.stringify(before), 'Navigation not persisted')
			assert(navigateToShape(editor, { ...nav, framing: 'fit' }) && editor.getCurrentPageId() === pageId, 'Cross-page navigation failed')
			const center = editor.getViewportPageBounds().center, targetCenter = editor.getShapePageBounds(destination)!.center
			assert(Math.abs(center.x - targetCenter.x) < 1 && Math.abs(center.y - targetCenter.y) < 1, 'Cross-page navigation did not land immediately')
		})

		const pivotShape = createShapeId('pivot-shape')
		editor.createShape({ id: pivotShape, type: 'geo', x: 100, y: 200, props: { w: 200, h: 100 } })
		const rotation: ShapeBinding = { ...binding, id: `${pivotShape}:rotation`, shapeId: pivotShape, runtimeProperty: 'rotation', options: { kind: 'rotation', mode: 'position', secondsPerTurn: 2, direction: 'clockwise', restAngle: 0, pivot: { x: 0, y: 0.5 } } }
		check('Rotation pivots default to center and stay proportional on resize', () => {
			const shape = editor.getShape(pivotShape)!
			const center = editor.getShapeGeometry(shape).bounds.center
			const legacy = { ...rotation, options: undefined }
			assert(transformOriginForBindings(editor, shape, [legacy], center).x === 100, 'Legacy center changed')
			const pivot = transformOriginForBindings(editor, shape, [rotation], center)
			assert(pivot.x === 0 && pivot.y === 50, 'Left pivot incorrect')
			editor.updateShape({ id: pivotShape, type: 'geo', props: { h: 300 } })
			assert(transformOriginForBindings(editor, editor.getShape(pivotShape)!, [rotation], center).y === 150, 'Pivot did not follow resize')
		})
		check('Rotation pivots persist through driver replacement, reload and undo', () => {
			dispatchShapeBindingAction(editor, { type: 'create_binding', binding: rotation })
			dispatchShapeBindingAction(editor, { type: 'update_binding', bindingId: rotation.id, patch: { pointReference: 'slot:/new-driver' } })
			loadSnapshot(editor.store, getSnapshot(editor.store))
			const current = bindingsFromShape(editor.getShape(pivotShape)!)[0]
			assert(current.options?.kind === 'rotation' && current.options.pivot?.x === 0, 'Pivot lost on replacement/reload')
			dispatchShapeBindingAction(editor, { type: 'update_binding', bindingId: rotation.id, patch: { options: { ...rotation.options as Extract<NonNullable<ShapeBinding['options']>, { kind: 'rotation' }>, pivot: { x: 1, y: 1 } } } })
			editor.undo()
			const restored = bindingsFromShape(editor.getShape(pivotShape)!)[0].options
			assert(restored?.kind === 'rotation' && restored.pivot?.x === 0, 'Pivot undo failed')
		})
		check('Rotated group pivots use local coordinates and do not move scale origin', () => {
			const sibling = createShapeId('pivot-sibling'), groupId = createShapeId('pivot-group')
			editor.createShape({ id: sibling, type: 'geo', x: 400, y: 200 })
			editor.groupShapes([pivotShape, sibling], { groupId })
			editor.updateShape({ id: groupId, type: 'group', rotation: Math.PI / 3 })
			const group = editor.getShape(groupId)!, child = editor.getShape(pivotShape)!
			const bounds = editor.getShapeGeometry(group).bounds
			const inherited = { ...rotation, shapeId: groupId }
			const origin = transformOriginForBindings(editor, child, [inherited], { x: 0, y: 0 })
			const page = editor.getShapePageTransform(child).applyToPoint(origin)
			const expected = editor.getShapePageTransform(group).applyToPoint({ x: bounds.x, y: bounds.center.y })
			assert(Math.abs(page.x - expected.x) < 0.001 && Math.abs(page.y - expected.y) < 0.001, 'Group pivot is not registered')
			const localCenter = editor.getShapeGeometry(child).bounds.center
			const scale = transformOriginForBindings(editor, child, [inherited], localCenter, 'scale')
			assert(scale.x === localCenter.x && scale.y === localCenter.y, 'Rotation changed scale center')
			const disabled = transformOriginForBindings(editor, child, [{ ...inherited, enabled: false }], localCenter)
			assert(disabled.x === localCenter.x, 'Disabled rotation affected pivot')
		})
		check('Malformed pivot options are rejected at the persistence boundary', () => {
			const invalid = migrateBinding({ ...rotation, options: { ...rotation.options, pivot: { x: 'bad', y: 0 } } })
			assert(!invalid?.options, 'Invalid pivot accepted')
		})

		const multi = createShapeId('multi-value')
		editor.createShape({ id: multi, type: 'geo', props: { w: 200, h: 120 } })
		const first: ShapeBinding = { ...binding, id: `${multi}:temperature`, shapeId: multi, name: 'Supply temperature', options: { kind: 'label', placement: 'bottom', gap: 5, caption: 'Supply', stackGap: 7 } }
		const second: ShapeBinding = { ...first, id: `${multi}:setpoint`, name: 'Setpoint', pointReference: 'slot:/setpoint' }
		check('Several point labels retain separate stable identities', () => {
			assert(dispatchShapeBindingAction(editor, { type: 'create_binding', binding: first }) === null, 'First label rejected')
			assert(dispatchShapeBindingAction(editor, { type: 'create_binding', binding: second }) === null, 'Second label rejected')
			const labels = bindingsFromShape(editor.getShape(multi)!)
			assert(labels.length === 2 && new Set(labels.map((item) => item.id)).size === 2, 'Labels replaced or shared identity')
			loadSnapshot(editor.store, getSnapshot(editor.store))
			assert(bindingsFromShape(editor.getShape(multi)!)[1].id === second.id, 'Identity changed on reload')
		})
		check('Editing, disabling and removing one value does not modify its sibling', () => {
			dispatchShapeBindingAction(editor, { type: 'update_binding', bindingId: second.id, patch: { pointReference: 'slot:/new-setpoint', enabled: false } })
			assert(bindingsFromShape(editor.getShape(multi)!)[0].pointReference === first.pointReference, 'Sibling driver changed')
			dispatchShapeBindingAction(editor, { type: 'remove_binding', bindingId: second.id })
			assert(bindingsFromShape(editor.getShape(multi)!).length === 1, 'Wrong label removed')
			editor.undo()
			assert(bindingsFromShape(editor.getShape(multi)!)[1].enabled === false, 'Disabled label not restored')
			editor.undo()
			assert(bindingsFromShape(editor.getShape(multi)!)[1].pointReference === second.pointReference, 'Driver undo failed')
		})
		check('Multiple values duplicate and paste independently', () => {
			const content = editor.getContentFromCurrentPage([multi])!
			editor.putContentOntoCurrentPage(content, { select: true })
			const copy = editor.getSelectedShapes()[0]
			const copied = bindingsFromShape(copy)
			assert(copied.length === 2 && copied.every((item) => item.shapeId === copy.id && ![first.id, second.id].includes(item.id)), 'Copy identities not scoped')
			dispatchShapeBindingAction(editor, { type: 'update_binding', bindingId: copied[0].id, patch: { name: 'Copy only' } })
			assert(bindingsFromShape(editor.getShape(multi)!)[0].name === first.name, 'Copy changed original')
		})
		const rotateA: ShapeBinding = { ...rotation, id: `${multi}:rotate-a`, shapeId: multi }
		const rotateB = { ...rotateA, id: `${multi}:rotate-b` }
		check('Conflicting additions and enable changes fail without replacing settings', () => {
			assert(dispatchShapeBindingAction(editor, { type: 'create_binding', binding: rotateA }) === null, 'Rotation rejected')
			const before = JSON.stringify(editor.getShape(multi)!.meta)
			assert(dispatchShapeBindingAction(editor, { type: 'create_binding', binding: rotateB }) !== null, 'Conflict accepted')
			assert(JSON.stringify(editor.getShape(multi)!.meta) === before, 'Conflict mutated metadata')
			assert(dispatchShapeBindingAction(editor, { type: 'create_binding', binding: { ...rotateB, enabled: false } }) === null, 'Disabled alternative rejected')
			assert(dispatchShapeBindingAction(editor, { type: 'update_binding', bindingId: rotateB.id, patch: { enabled: true } }) !== null, 'Conflicting re-enable accepted')
		})
		const moveX: ShapeBinding = { ...first, id: `${multi}:move-x`, runtimeProperty: 'movement', pointReference: 'x', options: { kind: 'movement', axis: 'x', mode: 'position', direction: 'positive', distance: 100, secondsPerCycle: 2 } }
		const moveY: ShapeBinding = { ...moveX, id: `${multi}:move-y`, pointReference: 'y', options: { ...moveX.options as Extract<NonNullable<ShapeBinding['options']>, { kind: 'movement' }>, axis: 'y' } }
		check('Independent movement axes coexist but conflicting axis edits are blocked', () => {
			assert(dispatchShapeBindingAction(editor, { type: 'create_binding', binding: moveX }) === null, 'X movement rejected')
			assert(dispatchShapeBindingAction(editor, { type: 'create_binding', binding: moveY }) === null, 'Y movement rejected')
			assert(dispatchShapeBindingAction(editor, { type: 'update_binding', bindingId: moveY.id, patch: { options: moveX.options } }) !== null, 'Axis collision accepted')
			const result = getRuntimeShapePresentation([moveX, moveY], { x: { point: 'x', value: 20 }, y: { point: 'y', value: 40 } })
			assert(result.translation?.x === 20 && result.translation.y === 40, 'Axes did not combine')
		})
		check('Continuous motion axes retain independent timings', () => {
			const travel = [moveX, moveY].map((item, index) => ({ ...item, options: { ...item.options as Extract<NonNullable<ShapeBinding['options']>, { kind: 'movement' }>, mode: 'travel' as const, secondsPerCycle: index + 2 } }))
			const result = getRuntimeShapePresentation(travel, { x: { point: 'x', value: 1 }, y: { point: 'y', value: 1 } })
			assert(result.motions?.length === 2 && result.motions[0].secondsPerCycle !== result.motions[1].secondsPerCycle, 'Motion axes merged')
		})
		check('Unknown and newer behavior entries survive known behavior edits', () => {
			const unknown = { key: 'future', runtimeProperty: 'future-effect', schemaVersion: 99, payload: { retained: true } }
			editor.updateShape({ id: multi, type: 'geo', meta: { ...editor.getShape(multi)!.meta, basBindings: [...editor.getShape(multi)!.meta.basBindings as JsonObject[], unknown] } })
			dispatchShapeBindingAction(editor, { type: 'update_binding', bindingId: first.id, patch: { name: 'Renamed' } })
			assert(unsupportedBindingCount(editor.getShape(multi)!) === 1, 'Unknown entry not reported')
			assert(JSON.stringify((editor.getShape(multi)!.meta.basBindings as JsonObject[]).at(-1)) === JSON.stringify(unknown), 'Unknown payload changed')
		})
		check('Labels on the same side stack and disabled labels leave no gap', () => {
			const stacks = [...labelStacks([first, second]).values()]
			assert(stacks.length === 1 && stacks[0].labels.length === 2, 'Same-side labels not stacked')
			assert([...labelStacks([first, { ...second, enabled: false }]).values()][0].labels.length === 1, 'Disabled label retained a slot')
		})
		check('Locked shapes reject behavior edits without creating history changes', () => {
			editor.updateShape({ id: multi, type: 'geo', isLocked: true })
			const before = JSON.stringify(editor.getShape(multi)!.meta)
			assert(dispatchShapeBindingAction(editor, { type: 'remove_binding', bindingId: first.id }) !== null, 'Locked edit accepted')
			assert(JSON.stringify(editor.getShape(multi)!.meta) === before, 'Locked metadata changed')
			editor.updateShape({ id: multi, type: 'geo', isLocked: false })
		})
		check('Nearest group owner wins consistently instead of record ordering', () => {
			const child = editor.getShape(pivotShape)!
			const group = editor.getShape(child.parentId as typeof child.id)!
			const parent = { ...rotation, id: 'parent-spin', shapeId: group.id, pointReference: 'on', options: { ...rotation.options as Extract<NonNullable<ShapeBinding['options']>, { kind: 'rotation' }>, mode: 'spin' as const } }
			const own = { ...parent, id: 'child-spin', shapeId: child.id, pointReference: 'off' }
			const resolved = bindingsForRenderedShape(editor, child, [parent, own])
			const result = getRuntimeShapePresentation(resolved, { on: { point: 'on', value: 1 }, off: { point: 'off', value: 0 } })
			assert(!result.spin && resolved.find((item) => item.runtimeProperty === 'rotation')?.id === own.id, 'Parent spin leaked through child override')
		})
		check('Movement vectors remain page-aligned inside rotated shapes', () => {
			const vectorShape = createShapeId('vector-conversion')
			editor.createShape({ id: vectorShape, type: 'geo', x: 100, y: 200, rotation: Math.PI / 2 })
			const vector = pageVectorInShapeSpace(editor, editor.getShape(vectorShape)!, { x: 80, y: 40 })
			assert(Math.abs(vector.x - 40) < 0.0001 && Math.abs(vector.y + 80) < 0.0001, 'Movement vector retained shape rotation')
		})
		check('Value text sizes persist independently and support native undo', () => {
			const before = bindingsFromShape(editor.getShape(multi)!).find((item) => item.id === first.id)!
			const options = { kind: 'label' as const, placement: 'bottom' as const, gap: 8, fontSize: 32 }
			assert(dispatchShapeBindingAction(editor, { type: 'update_binding', bindingId: first.id, patch: { options } }) === null, 'Size edit rejected')
			const saved = getSnapshot(editor.store)
			editor.undo()
			assert(JSON.stringify(bindingsFromShape(editor.getShape(multi)!).find((item) => item.id === first.id)?.options) === JSON.stringify(before.options), 'Size undo failed')
			loadSnapshot(editor.store, saved)
			const restored = bindingsFromShape(editor.getShape(multi)!).find((item) => item.id === first.id)!
			assert(restored.options?.kind === 'label' && restored.options.fontSize === 32, 'Size lost on reload')
			assert(migrateBinding({ ...restored, options: { ...options, fontSize: -1 } })?.options === undefined, 'Invalid size accepted')
		})
		check('Widget layout and content scale are independent', () => {
			for (const [type, w, h] of [['bas-table', 520, 260], ['bas-trend', 560, 320]] as const) {
				const normal = dataWidgetContentStyle(w, h)
				const doubled = dataWidgetContentStyle(w * 2, h * 2)
				assert(doubled.width === w * 2 && doubled.height === h * 2 && doubled.transform === normal.transform, 'Resize changed content scale')
				const scaled = dataWidgetContentStyle(w, h, 2)
				assert(scaled.width === w / 2 && scaled.height === h / 2 && scaled.transform === 'scale(2)', 'Independent scale failed')
				const legacy = dataWidgetContentStyle(w * 1.5, h)
				assert(legacy.width === w * 1.5 && legacy.height === h, 'Legacy aspect ratio was changed')
			}
		})
		check('Point badges classify Niagara point and writable types without guessing unknown types', () => {
			assert(pointType({ typeSpec: 'control:BooleanWritable' }) === 'boolean', 'Boolean writable badge')
			assert(pointType({ typeSpec: 'control:NumericPoint' }) === 'numeric', 'Numeric point badge')
			assert(pointType({ typeSpec: 'control:EnumWritable' }) === 'enum', 'Enum writable badge')
			assert(pointType({ typeSpec: 'custom:ControlPoint' }) === 'unknown' && pointType({}) === 'unknown', 'Unknown type guessed')
		})
		check('Equipment icons require direct metadata and distinguish controllers from equipment', () => {
			assert(containerKind({ ord: 'slot:/AHU', name: 'AHU 1' }) === 'folder', 'Name guessed equipment')
			assert(containerKind({ ord: 'slot:/x', metadata: { tags: [{ id: 'hs:equip', value: null }] } }) === 'equipment', 'Equipment marker ignored')
			assert(containerKind({ ord: 'slot:/x', metadata: { tags: [{ name: 'equip', value: 'false' }, { name: 'equipRef', value: 'AHU' }] } }) === 'folder', 'False or reference tag misclassified')
			assert(containerKind({ ord: 'slot:/x', metadata: { classification: { isDriverDevice: true } } }) === 'device', 'Device misclassified')
			assert(containerKind({ ord: 'slot:/x', features: ['point'], metadata: { tags: [{ name: 'equip' }] } }) === 'folder', 'Point treated as equipment')
		})
		stopIdentities()
		setResults(results)
	}
	return <><h1>Canvas regression checks</h1><p>Isolated canvas. No saved drawing or station connection.</p>
		<ul>{results.map((result) => <li key={result}>{result}</li>)}</ul>
		<div style={{ position: 'relative', height: 400 }}><Tldraw onMount={(editor) => {
			// tldraw runs onMount inside a history-ignored initialization transaction.
			const timer = window.setTimeout(() => run(editor), 0)
			return () => window.clearTimeout(timer)
		}} hideUi /></div></>
}

if (import.meta.env.DEV) {
	const root = createRoot(document.getElementById('root')!)
	root.render(<Fixture />)
	import.meta.hot?.dispose(() => root.unmount())
}
