import type { CSSProperties } from 'react'
import type { Editor, TLShape } from 'tldraw'
import { groupLeafShapes } from './bindingScope'
import type { LabelPlacement, PointSnapshot } from './types'
export function labelColorStyle(colorMode?: 'status' | 'custom', color?: string): CSSProperties | undefined {
	if (colorMode !== 'custom' || !color) return undefined
	return { backgroundColor: color, color: readableTextColor(color) }
}

export function labelStatusTextColor(snapshot: PointSnapshot) {
	const state = snapshotState(snapshot)
	return state === 'alarm' ? 'var(--tl-color-danger)' : state === 'override' ? 'var(--tl-color-warning)' : state === 'stale' ? '#9775cf' : 'var(--tl-color-text)'
}

export function labelFontStyle(editor: Editor, shape: TLShape): CSSProperties | undefined {
	const ownFont = shapeFontName(shape)
	const fontName = ownFont || commonGroupFontName(editor, shape)
	if (!fontName) return undefined
	const fontFamily = Object.entries(editor.getCurrentTheme().fonts)
		.find(([name]) => name === fontName)?.[1].fontFamily
	return fontFamily ? { fontFamily } : undefined
}

function commonGroupFontName(editor: Editor, shape: TLShape) {
	if (shape.type !== 'group') return undefined
	const fonts = groupLeafShapes(editor, shape)
		.map(shapeFontName)
		.filter((font): font is string => Boolean(font))
	if (!fonts.length) return undefined
	return fonts.every((font) => font === fonts[0]) ? fonts[0] : undefined
}

function shapeFontName(shape: TLShape) {
	const font = (shape.props as { font?: unknown }).font
	return typeof font === 'string' ? font : undefined
}

export function readableTextColor(color: string) {
	const match = /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color)
	if (!match) return '#ffffff'
	const luminance = (Number.parseInt(match[1], 16) * 299 + Number.parseInt(match[2], 16) * 587 + Number.parseInt(match[3], 16) * 114) / 1000
	return luminance > 150 ? '#111111' : '#ffffff'
}

export function labelPositionStyle(
	left: number,
	top: number,
	width: number,
	height: number,
	placement: LabelPlacement,
	gap: number,
	opacity?: number,
): CSSProperties {
	const safeGap = Math.max(0, gap)
	switch (placement) {
		case 'center': return { left: left + width / 2, top: top + height / 2, transform: 'translate(-50%, -50%)', opacity }
		case 'top': return { left: left + width / 2, top: top - safeGap, transform: 'translate(-50%, -100%)', opacity }
		case 'right': return { left: left + width + safeGap, top: top + height / 2, transform: 'translate(0, -50%)', opacity }
		case 'bottom': return { left: left + width / 2, top: top + height + safeGap, transform: 'translate(-50%, 0)', opacity }
		case 'left': return { left: left - safeGap, top: top + height / 2, transform: 'translate(-100%, -50%)', opacity }
	}
}

export function formatSnapshot(snapshot: { displayValue?: string; value?: unknown }) {
	if (snapshot.displayValue) return snapshot.displayValue
	if (snapshot.value == null) return 'No value'
	return String(snapshot.value)
}

export type SnapshotState = 'waiting' | 'alarm' | 'override' | 'stale' | 'active' | 'inactive' | 'ok'

/** The one point-status classifier shared by labels, fills and data widgets. */
export function snapshotState(snapshot?: { ok?: boolean; status?: string; value?: unknown }): SnapshotState {
	if (!snapshot) return 'waiting'
	const status = snapshot.status?.toLowerCase() || ''
	if (snapshot.ok === false || /alarm|fault|down|unacked/.test(status)) return 'alarm'
	if (/overrid|forced/.test(status)) return 'override'
	if (/stale/.test(status)) return 'stale'
	if (typeof snapshot.value === 'boolean') return snapshot.value ? 'active' : 'inactive'
	if (typeof snapshot.value === 'string') {
		if (/^(true|on|active|occupied|running)$/i.test(snapshot.value)) return 'active'
		if (/^(false|off|inactive|unoccupied|stopped)$/i.test(snapshot.value)) return 'inactive'
	}
	return 'ok'
}
