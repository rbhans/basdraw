import { createShapeId, type Editor, type JsonValue, type TLShapeId } from 'tldraw'
import type { BasdrawAgentCanvasCapability } from '../plugins/types'
import {
	BAS_TABLE_SHAPE_TYPE,
	BAS_TREND_SHAPE_TYPE,
	type BasTableShape,
	type BasTrendShape,
} from './DataWidgetShapes'
import { WEB_VIEW_TYPE, webViewUrl, type WebViewShape } from './WebViewShape'
import { bindingsFromShape, dispatchShapeBindingAction, readBindingDocument } from './shapeBindings'
import { migrateBinding } from './storage'
import type { DataWidgetPoint, ShapeBinding, TrendWidgetSeries } from './types'

const dataPointContract = 'Array of {pointReference, pointLabel, equipmentReference, equipmentLabel, fieldKey, fieldLabel} from verified connection results.'

export const dataWidgetAgentCapabilities: readonly BasdrawAgentCanvasCapability[] = [
	{
		id: 'table',
		title: 'Equipment table',
		description: 'Create or configure a native basdraw table containing related BAS points grouped by equipment and field.',
		operations: ['create', 'update'],
		inputSchema: {
			title: 'Non-empty table title.', stationAlias: 'Connection/station alias.', points: dataPointContract,
			showStatus: 'Optional boolean.', w: 'Optional width, 280–2000.', h: 'Optional height, 128–2000.', contentScale: 'Optional 0.25–4.',
		},
		inspect: (_editor, shape) => shape.type === BAS_TABLE_SHAPE_TYPE ? { ...shape.props } as JsonValue : null,
		execute: ({ editor, operation, shapeId, position, arguments: args }) => {
			const existing = operation === 'update' ? getShape(editor, shapeId, BAS_TABLE_SHAPE_TYPE) as BasTableShape : null
			const points = args.points === undefined && existing ? existing.props.points : parseDataPoints(args.points)
			const title = optionalString(args.title, existing?.props.title ?? 'Equipment values')
			const stationAlias = optionalString(args.stationAlias, existing?.props.stationAlias ?? '')
			if (!title || !stationAlias || !points.length) throw new Error('Table requires a title, stationAlias and at least one verified point.')
			const id = existing?.id ?? createShapeId()
			const w = boundedNumber(args.w, existing?.props.w ?? 520, 280, 2000)
			const h = boundedNumber(args.h, existing?.props.h ?? 260, 128, 2000)
			const props = {
				w, h, title, stationAlias, points,
				showStatus: optionalBoolean(args.showStatus, existing?.props.showStatus ?? true),
				...(args.contentScale !== undefined || existing?.props.contentScale !== undefined ? { contentScale: boundedNumber(args.contentScale, existing?.props.contentScale ?? 1, .25, 4) } : {}),
			}
			editor.markHistoryStoppingPoint(existing ? 'agent update table' : 'agent create table')
			if (existing) editor.updateShape<BasTableShape>({ id, type: BAS_TABLE_SHAPE_TYPE, props })
			else editor.createShape<BasTableShape>({ id, type: BAS_TABLE_SHAPE_TYPE, ...place(editor, position, w, h), props })
			return { shapeId: simpleId(id), type: BAS_TABLE_SHAPE_TYPE }
		},
	},
	{
		id: 'trend',
		title: 'Trend chart',
		description: 'Create or configure a native basdraw history chart for one or more verified BAS points.',
		operations: ['create', 'update'],
		inputSchema: {
			title: 'Non-empty chart title.', stationAlias: 'Connection/station alias.',
			series: 'Array of {pointReference, pointLabel, color}; color is a CSS hex color.',
			rangeMs: 'History range in milliseconds.', lineMode: 'line, smooth or step.',
			w: 'Optional width, 320–2400.', h: 'Optional height, 220–2000.', contentScale: 'Optional 0.25–4.',
		},
		inspect: (_editor, shape) => shape.type === BAS_TREND_SHAPE_TYPE ? { ...shape.props } as JsonValue : null,
		execute: ({ editor, operation, shapeId, position, arguments: args }) => {
			const existing = operation === 'update' ? getShape(editor, shapeId, BAS_TREND_SHAPE_TYPE) as BasTrendShape : null
			const series = args.series === undefined && existing ? existing.props.series : parseTrendSeries(args.series)
			const title = optionalString(args.title, existing?.props.title ?? 'Point history')
			const stationAlias = optionalString(args.stationAlias, existing?.props.stationAlias ?? '')
			if (!title || !stationAlias || !series.length) throw new Error('Trend requires a title, stationAlias and at least one verified series.')
			const lineMode = optionalString(args.lineMode, existing?.props.lineMode ?? 'line')
			if (!['line', 'smooth', 'step'].includes(lineMode)) throw new Error('lineMode must be line, smooth or step.')
			const id = existing?.id ?? createShapeId()
			const w = boundedNumber(args.w, existing?.props.w ?? 560, 320, 2400)
			const h = boundedNumber(args.h, existing?.props.h ?? 320, 220, 2000)
			const props = {
				w, h, title, stationAlias, series, lineMode,
				rangeMs: boundedNumber(args.rangeMs, existing?.props.rangeMs ?? 86_400_000, 60_000, 31_536_000_000),
				...(args.contentScale !== undefined || existing?.props.contentScale !== undefined ? { contentScale: boundedNumber(args.contentScale, existing?.props.contentScale ?? 1, .25, 4) } : {}),
			}
			editor.markHistoryStoppingPoint(existing ? 'agent update trend' : 'agent create trend')
			if (existing) editor.updateShape<BasTrendShape>({ id, type: BAS_TREND_SHAPE_TYPE, props })
			else editor.createShape<BasTrendShape>({ id, type: BAS_TREND_SHAPE_TYPE, ...place(editor, position, w, h), props })
			return { shapeId: simpleId(id), type: BAS_TREND_SHAPE_TYPE }
		},
	},
]

export const webViewAgentCapabilities: readonly BasdrawAgentCanvasCapability[] = [{
	id: 'web-view',
	title: 'Web view',
	description: 'Create or configure a sandboxed web surface on the canvas. Use only when the user asks to embed a page.',
	operations: ['create', 'update'],
	inputSchema: { url: 'HTTP or HTTPS URL without embedded credentials.', title: 'Display title.', w: 'Optional width, 320–2400.', h: 'Optional height, 240–2000.', contentScale: 'Optional 0.25–4.' },
	inspect: (_editor, shape) => shape.type === WEB_VIEW_TYPE ? { ...shape.props } as JsonValue : null,
	execute: ({ editor, operation, shapeId, position, arguments: args }) => {
		const existing = operation === 'update' ? getShape(editor, shapeId, WEB_VIEW_TYPE) as WebViewShape : null
		const url = webViewUrl(optionalString(args.url, existing?.props.url ?? ''))
		const title = optionalString(args.title, existing?.props.title ?? new URL(url).hostname)
		const id = existing?.id ?? createShapeId()
		const w = boundedNumber(args.w, existing?.props.w ?? 960, 320, 2400)
		const h = boundedNumber(args.h, existing?.props.h ?? 640, 240, 2000)
		const props = {
			w, h, url, title,
			...(args.contentScale !== undefined || existing?.props.contentScale !== undefined ? { contentScale: boundedNumber(args.contentScale, existing?.props.contentScale ?? 1, .25, 4) } : {}),
		}
		editor.markHistoryStoppingPoint(existing ? 'agent update web view' : 'agent create web view')
		if (existing) editor.updateShape<WebViewShape>({ id, type: WEB_VIEW_TYPE, props })
		else editor.createShape<WebViewShape>({ id, type: WEB_VIEW_TYPE, ...place(editor, position, w, h), props })
		return { shapeId: simpleId(id), type: WEB_VIEW_TYPE }
	},
}]

export const behaviorAgentCapabilities: readonly BasdrawAgentCanvasCapability[] = [{
	id: 'behavior',
	title: 'Live behavior',
	description: 'Create, update or remove one non-conflicting live data behavior on any canvas shape. Multiple behaviors and points may share a shape when their runtime channels do not conflict.',
	operations: ['create', 'update', 'delete'],
	inputSchema: {
		bindingId: 'Required for update/delete; use the exact inspected id.',
		key: 'Stable local key for create, such as supply-air-label.',
		name: 'Optional user-facing name.', enabled: 'Optional boolean.', stationAlias: 'Connection/station alias.',
		pointReference: 'Exact point reference from connection discovery.', pointLabel: 'Point display label.',
		runtimeProperty: 'fill, levelFill, label, visibility, opacity, rotation, scale or movement.',
		mapping: 'Mapping object: auto, boolean, number or enum.', options: 'Options object matching the chosen runtime property.',
	},
	inspect: (_editor, shape) => {
		const bindings = bindingsFromShape(shape)
		return bindings.length ? { bindings } as JsonValue : null
	},
	execute: ({ editor, operation, shapeId, arguments: args }) => {
		if (operation === 'delete') {
			const bindingId = requiredString(args.bindingId, 'bindingId')
			const error = dispatchShapeBindingAction(editor, { type: 'remove_binding', bindingId })
			if (error) throw new Error(error)
			return { removed: bindingId }
		}
		if (operation === 'update') {
			const bindingId = requiredString(args.bindingId, 'bindingId')
			const current = readBindingDocument(editor).bindings.find((binding) => binding.id === bindingId)
			if (!current) throw new Error(`Behavior ${bindingId} does not exist.`)
			const patch = parseBinding(args, current, true)
			const error = dispatchShapeBindingAction(editor, { type: 'update_binding', bindingId, patch })
			if (error) throw new Error(error)
			return { bindingId }
		}
		const shape = getShape(editor, shapeId)
		const key = requiredString(args.key, 'key').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80)
		if (!key) throw new Error('key must contain letters or numbers.')
		const binding = parseBinding(args, { id: `${shape.id}:${key}`, shapeId: shape.id }, false) as ShapeBinding
		const error = dispatchShapeBindingAction(editor, { type: 'create_binding', binding })
		if (error) throw new Error(error)
		return { bindingId: binding.id, shapeId: simpleId(shape.id) }
	},
}]

function parseBinding(args: Record<string, JsonValue>, base?: Pick<ShapeBinding, 'id' | 'shapeId'> | ShapeBinding, partial = false) {
	const raw: Record<string, unknown> = {
		...(base ?? { id: 'shape:placeholder:binding', shapeId: 'shape:placeholder' }),
		schemaVersion: 1,
		...(args.stationAlias !== undefined ? { stationAlias: args.stationAlias } : {}),
		...(args.pointReference !== undefined ? { pointReference: args.pointReference } : {}),
		...(args.pointLabel !== undefined ? { pointLabel: args.pointLabel } : {}),
		...(args.runtimeProperty !== undefined ? { runtimeProperty: args.runtimeProperty } : {}),
		mapping: args.mapping ?? ('mapping' in (base ?? {}) ? (base as ShapeBinding).mapping : { kind: 'auto' }),
		...(args.options !== undefined ? { options: args.options } : {}),
		...(args.name !== undefined ? { name: args.name } : {}),
		...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
	}
	if (partial) {
		const merged = migrateBinding(raw)
		if (!merged) throw new Error('Behavior arguments or options are invalid.')
		const patch: Partial<ShapeBinding> = {}
		for (const key of ['stationAlias', 'pointReference', 'pointLabel', 'runtimeProperty', 'mapping', 'options', 'name', 'enabled'] as const) {
			if (args[key] !== undefined) (patch as Record<string, unknown>)[key] = (merged as unknown as Record<string, unknown>)[key]
		}
		return patch
	}
	const binding = migrateBinding(raw)
	if (!binding) throw new Error('Behavior requires valid stationAlias, pointReference, pointLabel, runtimeProperty, mapping and options.')
	return binding
}

function getShape(editor: Editor, id: string | null, expectedType?: string): any {
	if (!id) throw new Error('shapeId is required for this operation.')
	const shape = editor.getShape(fullId(id))
	if (!shape) throw new Error(`Shape ${id} does not exist.`)
	if (shape.isLocked || editor.getShapeAncestors(shape).some((ancestor) => ancestor.isLocked)) throw new Error(`Shape ${id} or one of its containers is locked.`)
	if (expectedType && shape.type !== expectedType) throw new Error(`Shape ${id} is not a ${expectedType}.`)
	return shape
}

function fullId(id: string): TLShapeId { return (id.startsWith('shape:') ? id : `shape:${id}`) as TLShapeId }
function simpleId(id: TLShapeId) { return id.slice(6) }
function place(editor: { getViewportPageBounds(): { center: { x: number; y: number } } }, position: { x: number; y: number } | null, w: number, h: number) {
	const center = position ?? editor.getViewportPageBounds().center
	return { x: center.x - w / 2, y: center.y - h / 2 }
}
function requiredString(value: JsonValue | undefined, field: string) {
	if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`)
	return value.trim()
}
function optionalString(value: JsonValue | undefined, fallback: string) { return typeof value === 'string' ? value.trim() : fallback }
function optionalBoolean(value: JsonValue | undefined, fallback: boolean) {
	if (value === undefined) return fallback
	if (typeof value !== 'boolean') throw new Error('Expected a boolean value.')
	return value
}
function boundedNumber(value: JsonValue | undefined, fallback: number, min: number, max: number) {
	const number = value === undefined ? fallback : value
	if (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max) throw new Error(`Expected a number from ${min} to ${max}.`)
	return number
}
function parseDataPoints(value: JsonValue | undefined): DataWidgetPoint[] {
	if (!Array.isArray(value)) throw new Error('points must be an array.')
	return value.map((item, index) => {
		if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`points[${index}] must be an object.`)
		return {
			pointReference: requiredString(item.pointReference, `points[${index}].pointReference`),
			pointLabel: requiredString(item.pointLabel, `points[${index}].pointLabel`),
			equipmentReference: requiredString(item.equipmentReference, `points[${index}].equipmentReference`),
			equipmentLabel: requiredString(item.equipmentLabel, `points[${index}].equipmentLabel`),
			fieldKey: requiredString(item.fieldKey, `points[${index}].fieldKey`),
			fieldLabel: requiredString(item.fieldLabel, `points[${index}].fieldLabel`),
		}
	})
}
function parseTrendSeries(value: JsonValue | undefined): TrendWidgetSeries[] {
	if (!Array.isArray(value)) throw new Error('series must be an array.')
	return value.map((item, index) => {
		if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`series[${index}] must be an object.`)
		const color = requiredString(item.color, `series[${index}].color`)
		if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`series[${index}].color must be a six-digit hex color.`)
		return { pointReference: requiredString(item.pointReference, `series[${index}].pointReference`), pointLabel: requiredString(item.pointLabel, `series[${index}].pointLabel`), color }
	})
}
