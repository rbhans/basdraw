import type { TLAsset } from 'tldraw'

const NS = 'http://www.w3.org/2000/svg'
const fillSources = new WeakMap<TLAsset, string>()

/** Derive runtime coverage without changing the saved SVG or requiring a reimport. */
export function pdfFillSource(asset: TLAsset): string | null {
	if (asset.type !== 'image' || !asset.props.src) return null
	const source = asset.props.src
	const cached = fillSources.get(asset)
	if (cached) return cached
	let result = source
	try {
		if (source.startsWith('data:image/svg+xml;charset=utf-8,')) {
			const svg = addClosedOutlineInteriors(decodeURIComponent(source.slice(source.indexOf(',') + 1)))
			result = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
		}
	} catch {
		// Unrecognized/invalid artwork retains its existing alpha-mask behavior.
	}
	fillSources.set(asset, result)
	return result
}

/** Keep the original painted pixels and add only genuinely closed, unfilled contours. */
export function addClosedOutlineInteriors(source: string): string {
	const doc = new DOMParser().parseFromString(source, 'image/svg+xml')
	if (doc.querySelector('parsererror')) return source
	for (const element of doc.querySelectorAll('path,rect,circle,ellipse,polygon')) {
		if (element.closest('defs,clipPath,mask,symbol,pattern')) continue
		if (inheritedFill(element) !== 'none') continue
		const interior = element.cloneNode(true) as SVGElement
		if (element.localName === 'path') {
			const closed = closedSubpaths(element.getAttribute('d') || '')
			if (!closed) continue
			interior.setAttribute('d', closed)
		}
		interior.removeAttribute('id')
		interior.style.fill = 'white'
		interior.style.fillOpacity = '1'
		interior.style.stroke = 'none'
		element.parentNode?.insertBefore(interior, element)
	}
	return new XMLSerializer().serializeToString(doc.documentElement)
}

function inheritedFill(element: Element): string {
	for (let current: Element | null = element; current; current = current.parentElement) {
		const fill = (current as SVGElement).style?.fill || current.getAttribute('fill')
		if (fill && fill !== 'inherit') return fill.trim().toLowerCase()
	}
	return 'black'
}

/**
 * PDF/Cairo often closes contours by returning to the starting point, without Z.
 * Let the browser evaluate curves/arcs; never implicitly close an open pipe or diagonal.
 * Relative movetos are normalized so extracted subpaths keep their original position.
 */
export function closedSubpaths(d: string): string {
	const measure = document.createElementNS(NS, 'path')
	const number = '[+-]?(?:\\d*\\.\\d+|\\d+\\.?\\d*)(?:[eE][+-]?\\d+)?'
	const move = new RegExp(`^([Mm])\\s*(${number})[\\s,]*(${number})`)
	let previous = { x: 0, y: 0 }
	const closed: string[] = []
	for (const part of d.match(/[Mm][^Mm]*/g) || []) {
		const start = part.match(move)
		if (!start) return ''
		const relative = start[1] === 'm'
		const x = Number(start[2]) + (relative ? previous.x : 0)
		const y = Number(start[3]) + (relative ? previous.y : 0)
		// Extra moveto coordinate pairs are implicit lineto commands, in the same mode.
		const rest = part.slice(start[0].length)
		const implicitLine = /^[\s,]*[+\-.\d]/.test(rest) ? (relative ? 'l' : 'L') : ''
		const normalized = `M${x} ${y} ${implicitLine}${rest}`
		measure.setAttribute('d', normalized)
		const length = measure.getTotalLength()
		const end = measure.getPointAtLength(length)
		previous = end
		if (length > 0 && Math.hypot(end.x - x, end.y - y) <= 0.0001) closed.push(normalized)
	}
	return closed.join(' ')
}
