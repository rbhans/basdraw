/**
 * Structural equality for JSON-like values (plain objects, arrays and primitives).
 * Kept dependency-free so it can be shared by the client, the worker and node tests.
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
	if (Array.isArray(a) !== Array.isArray(b)) return false
	if (Array.isArray(a)) {
		const other = b as unknown[]
		if (a.length !== other.length) return false
		for (let i = 0; i < a.length; i++) if (!jsonEqual(a[i], other[i])) return false
		return true
	}
	const aRecord = a as Record<string, unknown>
	const bRecord = b as Record<string, unknown>
	const aKeys = Object.keys(aRecord).filter((key) => aRecord[key] !== undefined)
	const bKeys = Object.keys(bRecord).filter((key) => bRecord[key] !== undefined)
	if (aKeys.length !== bKeys.length) return false
	for (const key of aKeys) {
		if (!Object.prototype.hasOwnProperty.call(bRecord, key)) return false
		if (!jsonEqual(aRecord[key], bRecord[key])) return false
	}
	return true
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Get the fields that differ between two versions of a focused shape.
 * Values are compared structurally, so freshly built objects (e.g. the bounded
 * `props` snapshot of unknown shapes) only count as changed when their content
 * changed. For `props`, only the changed keys are reported.
 *
 * @returns The changed fields, or null if nothing changed.
 */
export function getChangedFields<T extends Record<string, unknown>>(
	from: T,
	to: T
): { from: Partial<T>; to: Partial<T> } | null {
	const change: { from: Record<string, unknown>; to: Record<string, unknown> } = { from: {}, to: {} }
	let changed = false
	const keys = new Set([...Object.keys(from), ...Object.keys(to)])
	for (const key of keys) {
		const fromValue = from[key]
		const toValue = to[key]
		if (jsonEqual(fromValue, toValue)) continue
		changed = true
		if (key === 'props' && isPlainObject(fromValue) && isPlainObject(toValue)) {
			const fromProps: Record<string, unknown> = {}
			const toProps: Record<string, unknown> = {}
			for (const propKey of new Set([...Object.keys(fromValue), ...Object.keys(toValue)])) {
				if (jsonEqual(fromValue[propKey], toValue[propKey])) continue
				fromProps[propKey] = fromValue[propKey]
				toProps[propKey] = toValue[propKey]
			}
			change.from[key] = fromProps
			change.to[key] = toProps
			continue
		}
		change.from[key] = fromValue
		change.to[key] = toValue
	}
	return changed ? (change as { from: Partial<T>; to: Partial<T> }) : null
}
