import type { BindingOptions, BindingValueMapping, CanvasDocument, ConnectionProfile, ShapeBinding } from './types'

const documentKey = 'bas-whiteboard.document.v2'
const legacyDocumentKey = 'bas-whiteboard.document.v1'
const profilesKey = 'bas-whiteboard.connection-profiles.v1'

const emptyDocument: CanvasDocument = { version: 2, stationAlias: null, bindings: [] }

export function loadCanvasDocument(): CanvasDocument {
	try {
		const value = JSON.parse(localStorage.getItem(documentKey) || localStorage.getItem(legacyDocumentKey) || 'null')
		if ((value?.version !== 1 && value?.version !== 2) || !Array.isArray(value.bindings)) return emptyDocument
		return {
			version: 2,
			stationAlias: typeof value.stationAlias === 'string' ? value.stationAlias : null,
			bindings: value.bindings
				.map(migrateBinding)
				.filter((binding: ShapeBinding | null): binding is ShapeBinding => Boolean(binding)),
		}
	} catch {
		return emptyDocument
	}
}

export function saveCanvasDocument(document: CanvasDocument) {
	localStorage.setItem(documentKey, JSON.stringify(document))
}

export function loadConnectionProfiles(): ConnectionProfile[] {
	try {
		const value = JSON.parse(localStorage.getItem(profilesKey) || '[]')
		if (!Array.isArray(value)) return []
		return value.filter((profile) => isProfile(profile))
	} catch {
		return []
	}
}

export function saveConnectionProfile(profile: ConnectionProfile) {
	const profiles = loadConnectionProfiles().filter((candidate) => candidate.alias !== profile.alias)
	localStorage.setItem(profilesKey, JSON.stringify([...profiles, profile]))
}

export function removeConnectionProfile(alias: string) {
	localStorage.setItem(
		profilesKey,
		JSON.stringify(loadConnectionProfiles().filter((profile) => profile.alias !== alias))
	)
}

function isProfile(value: unknown): value is ConnectionProfile {
	if (!value || typeof value !== 'object') return false
	const record = value as Record<string, unknown>
	return typeof record.alias === 'string' &&
		typeof record.name === 'string' &&
		typeof record.stationUrl === 'string' &&
		typeof record.username === 'string' &&
		(record.tlsMode === 'strict' || record.tlsMode === 'insecure') &&
		!('password' in record) &&
		!('sessionToken' in record)
}

export function migrateBinding(value: unknown): ShapeBinding | null {
	if (!value || typeof value !== 'object') return null
	const record = value as Record<string, unknown>
	if (record.schemaVersion !== undefined && record.schemaVersion !== 1) return null
	if (!(typeof record.id === 'string' &&
		typeof record.shapeId === 'string' &&
		typeof record.stationAlias === 'string' &&
		typeof record.pointReference === 'string' &&
		typeof record.pointLabel === 'string' &&
		isRuntimeProperty(record.runtimeProperty))) return null
	return {
		id: record.id,
		name: typeof record.name === 'string' ? record.name : undefined,
		enabled: typeof record.enabled === 'boolean' ? record.enabled : undefined,
		shapeId: record.shapeId,
		stationAlias: record.stationAlias,
		pointReference: record.pointReference,
		pointLabel: record.pointLabel,
		runtimeProperty: record.runtimeProperty,
		mapping: isMapping(record.mapping) ? record.mapping : { kind: 'auto' },
		options: isBindingOptions(record.options) ? record.options : undefined,
	}
}

function isRuntimeProperty(value: unknown): value is ShapeBinding['runtimeProperty'] {
	return value === 'fill' || value === 'levelFill' || value === 'label' || value === 'visibility' || value === 'opacity' || value === 'rotation' || value === 'scale' || value === 'movement'
}

function isMapping(value: unknown): value is BindingValueMapping {
	if (!value || typeof value !== 'object') return false
	const record = value as Record<string, unknown>
	if (record.kind === 'auto') return true
	if (record.kind === 'boolean') return typeof record.falseValue === 'number' && typeof record.trueValue === 'number'
	if (record.kind === 'number') {
		return typeof record.inputMin === 'number' && typeof record.inputMax === 'number' &&
			typeof record.outputMin === 'number' && typeof record.outputMax === 'number' &&
			typeof record.clamp === 'boolean'
	}
	if (record.kind === 'enum') {
		return Array.isArray(record.entries) && record.entries.every((entry) => {
			if (!entry || typeof entry !== 'object') return false
			const candidate = entry as Record<string, unknown>
			return typeof candidate.match === 'string' && typeof candidate.output === 'number'
		}) && typeof record.fallback === 'number'
	}
	return false
}

function isBindingOptions(value: unknown): value is BindingOptions {
	if (!value || typeof value !== 'object') return false
	const record = value as Record<string, unknown>
	if (record.kind === 'label') {
		return (record.placement === 'center' || record.placement === 'top' || record.placement === 'right' || record.placement === 'bottom' || record.placement === 'left') &&
			typeof record.gap === 'number' &&
			(record.colorMode === undefined || record.colorMode === 'status' || record.colorMode === 'custom') &&
			(record.color === undefined || typeof record.color === 'string') &&
			(record.background === undefined || record.background === 'solid' || record.background === 'none') &&
			(record.caption === undefined || typeof record.caption === 'string') &&
			(record.stackGap === undefined || (typeof record.stackGap === 'number' && Number.isFinite(record.stackGap) && record.stackGap >= 0)) &&
			(record.fontSize === undefined || (typeof record.fontSize === 'number' && Number.isFinite(record.fontSize) && record.fontSize >= 6 && record.fontSize <= 144)) &&
			(record.cornerRadius === undefined || (typeof record.cornerRadius === 'number' && Number.isFinite(record.cornerRadius) && record.cornerRadius >= 0))
	}
	if (record.kind === 'rotation') {
		return (record.mode === 'position' || record.mode === 'spin') &&
			typeof record.secondsPerTurn === 'number' &&
			(record.direction === 'clockwise' || record.direction === 'counterclockwise') &&
			typeof record.restAngle === 'number' &&
			(record.pivot === undefined || (isRecord(record.pivot) &&
				typeof record.pivot.x === 'number' && Number.isFinite(record.pivot.x) &&
				typeof record.pivot.y === 'number' && Number.isFinite(record.pivot.y)))
	}
	if (record.kind === 'levelFill') {
		return typeof record.color === 'string' &&
			(record.direction === 'up' || record.direction === 'down' || record.direction === 'left' || record.direction === 'right')
	}
	if (record.kind === 'movement') {
		return (record.mode === 'position' || record.mode === 'travel') &&
			(record.axis === 'x' || record.axis === 'y') &&
			(record.direction === 'positive' || record.direction === 'negative') &&
			typeof record.distance === 'number' &&
			typeof record.secondsPerCycle === 'number'
	}
	return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
}
