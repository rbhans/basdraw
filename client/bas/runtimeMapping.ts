import { resolveBehaviorChannels } from './behaviorDefinitions'
import type { BindingValueMapping, PointSnapshot, RuntimeProperty, ShapeBinding } from './types'

export type RuntimeShapePresentation = {
	visible?: boolean
	opacity?: number
	translation?: { x: number; y: number }
	rotation?: number
	scale?: number
	spin?: { secondsPerTurn: number; direction: 'clockwise' | 'counterclockwise' }
	motions?: Array<{ x: number; y: number; secondsPerCycle: number }>
	motion?: { x: number; y: number; secondsPerCycle: number }
}

export function evaluateBinding(binding: ShapeBinding, snapshot: PointSnapshot): number | null {
	return evaluateMapping(binding.mapping || { kind: 'auto' }, snapshot)
}

export function evaluateMapping(mapping: BindingValueMapping, snapshot: PointSnapshot): number | null {
	switch (mapping.kind) {
		case 'auto':
			return numericValue(snapshot.value ?? snapshot.displayValue ?? snapshot.display)
		case 'boolean': {
			const value = booleanValue(snapshot.value ?? snapshot.displayValue ?? snapshot.display)
			return value == null ? null : value ? mapping.trueValue : mapping.falseValue
		}
		case 'number': {
			const value = numericValue(snapshot.value ?? snapshot.displayValue ?? snapshot.display)
			if (value == null) return null
			if (mapping.inputMax === mapping.inputMin) return mapping.outputMin
			let progress = (value - mapping.inputMin) / (mapping.inputMax - mapping.inputMin)
			if (mapping.clamp) progress = clamp(progress, 0, 1)
			return mapping.outputMin + progress * (mapping.outputMax - mapping.outputMin)
		}
		case 'enum': {
			const candidates = [snapshot.value, snapshot.displayValue, snapshot.display]
				.filter((value): value is NonNullable<typeof value> => value != null)
				.map((value) => String(value).trim().toLowerCase())
			const entry = mapping.entries.find(({ match }) => candidates.includes(match.trim().toLowerCase()))
			return entry?.output ?? mapping.fallback
		}
	}
}

export function getRuntimeShapePresentation(
	bindings: ShapeBinding[],
	snapshots: Record<string, PointSnapshot>,
): RuntimeShapePresentation {
	const presentation: RuntimeShapePresentation = {}
	for (const binding of resolveBehaviorChannels(bindings)) {
		if (binding.enabled === false) continue
		const snapshot = snapshots[binding.pointReference]
		if (!snapshot) continue
		const output = evaluateBinding(binding, snapshot)
		if (output == null || !Number.isFinite(output)) continue
		switch (binding.runtimeProperty) {
			case 'visibility':
				presentation.visible = output >= 0.5
				break
			case 'opacity':
				presentation.opacity = clamp(output, 0, 1)
				break
			case 'rotation':
				if (binding.options?.kind === 'rotation' && binding.options.mode === 'spin') {
					presentation.rotation = binding.options.restAngle
					if (output >= 0.5) {
						presentation.spin = {
							secondsPerTurn: clamp(binding.options.secondsPerTurn, 0.1, 60),
							direction: binding.options.direction,
						}
					}
				} else {
					presentation.rotation = output
				}
				break
			case 'scale':
				presentation.scale = clamp(output, 0.05, 4)
				break
			case 'movement': {
				const options = binding.options?.kind === 'movement'
					? binding.options
					: {
						mode: 'position' as const,
						axis: 'x' as const,
						direction: 'positive' as const,
						distance: 100,
						secondsPerCycle: 2,
					}
				if (options.mode === 'travel') {
					if (output >= 0.5) {
						const signedDistance = Math.max(0, options.distance) * (options.direction === 'negative' ? -1 : 1)
						const motion = {
							x: options.axis === 'x' ? signedDistance : 0,
							y: options.axis === 'y' ? signedDistance : 0,
							secondsPerCycle: clamp(options.secondsPerCycle, 0.2, 120),
						}
						presentation.motions = [...(presentation.motions || []), motion]
					}
				} else {
					presentation.translation = {
						x: options.axis === 'x' ? output : presentation.translation?.x || 0,
						y: options.axis === 'y' ? output : presentation.translation?.y || 0,
					}
				}
				break
			}
		}
	}
	return presentation
}

export function defaultMappingFor(property: RuntimeProperty): BindingValueMapping {
	switch (property) {
		case 'visibility':
			return { kind: 'boolean', falseValue: 0, trueValue: 1 }
		case 'opacity':
			return { kind: 'number', inputMin: 0, inputMax: 100, outputMin: 0.1, outputMax: 1, clamp: true }
		case 'rotation':
			return { kind: 'number', inputMin: 0, inputMax: 100, outputMin: 0, outputMax: 360, clamp: true }
		case 'scale':
			return { kind: 'number', inputMin: 0, inputMax: 100, outputMin: 0.5, outputMax: 1.5, clamp: true }
		case 'movement':
			return { kind: 'number', inputMin: 0, inputMax: 100, outputMin: 0, outputMax: 100, clamp: true }
		case 'levelFill':
			return { kind: 'number', inputMin: 0, inputMax: 100, outputMin: 0, outputMax: 100, clamp: true }
		default:
			return { kind: 'auto' }
	}
}

export function runtimePropertyLabel(property: RuntimeProperty) {
	switch (property) {
		case 'label': return 'Live value label'
		case 'fill': return 'Runtime status fill'
		case 'levelFill': return 'Percentage level fill'
		case 'visibility': return 'Visibility'
		case 'opacity': return 'Opacity'
		case 'rotation': return 'Rotation'
		case 'scale': return 'Scale'
		case 'movement': return 'Move'
	}
}

export function mappingSummary(mapping: BindingValueMapping) {
	switch (mapping.kind) {
		case 'auto': return 'Automatic value'
		case 'boolean': return `False ${formatNumber(mapping.falseValue)} · True ${formatNumber(mapping.trueValue)}`
		case 'number': return `${formatNumber(mapping.inputMin)}–${formatNumber(mapping.inputMax)} → ${formatNumber(mapping.outputMin)}–${formatNumber(mapping.outputMax)}`
		case 'enum': return mapping.entries.map((entry) => `${entry.match}=${formatNumber(entry.output)}`).join(', ') || `Fallback ${formatNumber(mapping.fallback)}`
	}
}

export function formatMappedOutput(property: RuntimeProperty, value: number | null) {
	if (value == null || !Number.isFinite(value)) return 'No mapped output'
	switch (property) {
		case 'visibility': return value >= 0.5 ? 'Shown' : 'Hidden'
		case 'opacity': return `${Math.round(clamp(value, 0, 1) * 100)}% opacity`
		case 'rotation': return `${formatNumber(value)}° rotation`
		case 'scale': return `${formatNumber(clamp(value, 0.05, 4))}× scale`
		case 'movement': return `${formatNumber(value)}px offset`
		case 'levelFill': return `${formatNumber(clamp(value, 0, 100))}% filled`
		default: return formatNumber(value)
	}
}

export function bindingOptionsSummary(binding: ShapeBinding) {
	const options = binding.options
	if (!options) return null
	switch (options.kind) {
		case 'label': return `${capitalize(options.placement)} · ${formatNumber(options.gap)}px gap · ${options.colorMode === 'custom' ? (options.color || '#111111').toUpperCase() : 'Point status color'}`
		case 'rotation': return options.mode === 'spin'
			? `Spin ${options.direction} · ${formatNumber(options.secondsPerTurn)}s per turn`
			: `Centered position · rests at ${formatNumber(options.restAngle)}°`
		case 'levelFill': return `${capitalize(options.direction)} · ${options.color.toUpperCase()}`
		case 'movement': return options.mode === 'travel'
			? `${directionLabel(options.axis, options.direction)} · ${formatNumber(options.distance)}px · ${formatNumber(options.secondsPerCycle)}s cycle`
			: `${options.axis === 'x' ? 'Horizontal' : 'Vertical'} mapped position`
	}
}

function directionLabel(axis: 'x' | 'y', direction: 'positive' | 'negative') {
	if (axis === 'x') return direction === 'positive' ? 'Right' : 'Left'
	return direction === 'positive' ? 'Down' : 'Up'
}

function numericValue(value: unknown): number | null {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null
	if (typeof value === 'boolean') return value ? 1 : 0
	if (typeof value !== 'string') return null
	const normalized = value.trim().toLowerCase()
	if (/^(true|on|active|occupied|running|open)$/.test(normalized)) return 1
	if (/^(false|off|inactive|unoccupied|stopped|closed)$/.test(normalized)) return 0
	const parsed = Number.parseFloat(normalized)
	return Number.isFinite(parsed) ? parsed : null
}

function booleanValue(value: unknown): boolean | null {
	if (typeof value === 'boolean') return value
	if (typeof value === 'number') return value !== 0
	if (typeof value !== 'string') return null
	const normalized = value.trim().toLowerCase()
	if (/^(true|on|active|occupied|running|open|1)$/.test(normalized)) return true
	if (/^(false|off|inactive|unoccupied|stopped|closed|0)$/.test(normalized)) return false
	return null
}

function formatNumber(value: number) {
	return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)))
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value))
}

function capitalize(value: string) {
	return value.charAt(0).toUpperCase() + value.slice(1)
}
