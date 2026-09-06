import type { RuntimeProperty, ShapeBinding } from './types'

// One place for catalog and channel ownership. UI and mutation guards share it.
export const behaviorDefinitions = {
	label: { label: 'Value label', description: 'Show another point’s value', group: 'Display', channel: null },
	fill: { label: 'Status color', description: 'Reflect point status', group: 'Display', channel: 'status-fill' },
	levelFill: { label: 'Percentage fill', description: 'Fill from empty to full', group: 'Display', channel: 'level-fill' },
	rotation: { label: 'Rotate', description: 'Follow a value or spin', group: 'Motion', channel: 'rotation' },
	movement: { label: 'Move', description: 'Position or repeat travel', group: 'Motion', channel: 'movement' },
	scale: { label: 'Scale', description: 'Grow or shrink', group: 'Motion', channel: 'scale' },
	visibility: { label: 'Visibility', description: 'Show or hide', group: 'Appearance', channel: 'visibility' },
	opacity: { label: 'Opacity', description: 'Fade in or out', group: 'Appearance', channel: 'opacity' },
} as const satisfies Record<RuntimeProperty, { label: string; description: string; group: string; channel: string | null }>

export function behaviorChannel(binding: Pick<ShapeBinding, 'runtimeProperty' | 'options'>) {
	if (binding.runtimeProperty === 'movement') return `movement-${binding.options?.kind === 'movement' ? binding.options.axis : 'x'}`
	return behaviorDefinitions[binding.runtimeProperty].channel
}

export function behaviorConflict(candidate: ShapeBinding, bindings: ShapeBinding[]): string | null {
	if (candidate.enabled === false) return null
	const channel = behaviorChannel(candidate)
	if (!channel) return null
	const conflict = bindings.find((item) => item.id !== candidate.id && item.shapeId === candidate.shapeId && item.enabled !== false && behaviorChannel(item) === channel)
	return conflict ? `${behaviorDefinitions[candidate.runtimeProperty].label} conflicts with “${conflict.name || conflict.pointLabel}”. Edit or disable that behavior first${candidate.runtimeProperty === 'movement' ? ', or choose the other axis' : ''}.` : null
}

// Loaded legacy conflicts resolve consistently: nearest owner is supplied first,
// then the first enabled behavior owns the channel, even when its point is offline.
export function resolveBehaviorChannels(bindings: ShapeBinding[]) {
	const used = new Set<string>()
	return bindings.filter((binding) => {
		if (binding.enabled === false) return false
		const channel = behaviorChannel(binding)
		if (!channel) return true
		if (used.has(channel)) return false
		used.add(channel)
		return true
	})
}
