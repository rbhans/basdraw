import type { CSSProperties } from 'react'

// Box dimensions control layout; the independently saved scale controls contents.
// Missing scale on older drawings means 100%.
export function dataWidgetContentStyle(w: number, h: number, contentScale = 1): CSSProperties {
	const scale = Number.isFinite(contentScale) ? Math.max(0.25, Math.min(4, contentScale)) : 1
	return { width: w / scale, height: h / scale, transform: `scale(${scale})`, transformOrigin: 'top left' }
}
