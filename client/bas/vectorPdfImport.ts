import { AssetRecordType, createShapeId, sanitizeSvg, type Editor, type TLAsset, type TLShapePartial, type TLShapeId } from 'tldraw'

const NS = 'http://www.w3.org/2000/svg'
export type VectorPiece = { x: number; y: number; w: number; h: number; svg: string; kind: 'vector' | 'text' | 'image' }
export type VectorPage = { width: number; height: number; pieces: VectorPiece[]; preview: string; rasterPieces: number }
export const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

/** Split painted objects, not individual path commands. Compound paths remain intact. */
export function splitVectorPage(source: string): VectorPage {
	if (source.length > 20 * 1024 * 1024) throw new Error('This vector page is too large to import.')
	const input = new DOMParser().parseFromString(source, 'image/svg+xml')
	for (const element of input.querySelectorAll('*')) for (const attr of [...element.attributes]) {
		if (attr.localName === 'href' && !attr.value.startsWith('#') && !(element.localName === 'image' && /^data:image\/(png|jpeg);base64,/i.test(attr.value))) throw new Error('External SVG references are not supported.')
	}
	const safe = sanitizeSvg(source)
	const doc = new DOMParser().parseFromString(safe, 'image/svg+xml')
	const svg = doc.documentElement as unknown as SVGSVGElement
	if (svg.localName !== 'svg' || doc.querySelector('parsererror')) throw new Error('The PDF converter returned invalid vector content.')
	// No active or externally fetched content belongs in an imported drawing.
	if (svg.querySelector('script,foreignObject,iframe,style,animate,animateTransform,set')) throw new Error('Unsupported active SVG content.')
	for (const element of [svg, ...svg.querySelectorAll('*')]) for (const attr of [...element.attributes]) {
		if (/^on/i.test(attr.name) || [...attr.value.matchAll(/url\(([^)]+)\)/gi)].some(match => !match[1].trim().replace(/^['"]|['"]$/g, '').startsWith('#'))) throw new Error('External SVG content is not supported.')
		if (attr.localName === 'href' && !attr.value.startsWith('#') && !(element.localName === 'image' && /^data:image\/(png|jpeg);base64,/i.test(attr.value))) throw new Error('External SVG references are not supported.')
	}
	const box = svg.viewBox.baseVal
	const width = box.width || parseFloat(svg.getAttribute('width') || ''), height = box.height || parseFloat(svg.getAttribute('height') || '')
	if (![width, height].every(n => Number.isFinite(n) && n > 0 && n <= 30000)) throw new Error('Unsupported PDF page dimensions.')
	const vx = box.x || 0, vy = box.y || 0
	svg.setAttribute('width', String(width)); svg.setAttribute('height', String(height))
	if (!box.width) svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
	const host = document.createElement('div')
	host.style.cssText = 'position:fixed;left:-100000px;top:0;opacity:0;pointer-events:none;'
	host.appendChild(svg); document.body.appendChild(host)
	try {
		const candidates: SVGGraphicsElement[] = []
		const textRun = (element: Element) => element.localName === 'g' && !!element.children.length && [...element.children].every(child => child.localName === 'use')
		const walk = (element: Element) => {
			if (['defs', 'clipPath', 'mask', 'symbol', 'pattern', 'metadata', 'title', 'desc'].includes(element.localName)) return
			// Cairo groups glyph uses into text runs. Keep the run selectable as one piece.
			const style = element.localName === 'g' ? getComputedStyle(element) : null
			// Compositing groups cannot be split without changing overlap/opacity semantics.
			if (textRun(element) || (style && (Number(style.opacity) < 1 || style.filter !== 'none' || style.maskImage !== 'none' || style.mixBlendMode !== 'normal'))) { candidates.push(element as SVGGraphicsElement); return }
			if (['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'use', 'image', 'text'].includes(element.localName)) { candidates.push(element as SVGGraphicsElement); return }
			for (const child of element.children) walk(child)
		}
		walk(svg)
		if (candidates.length > 3000) throw new Error(`This page contains ${candidates.length.toLocaleString()} pieces. Export a smaller drawing area (limit 3,000).`)
		const ids = new Map([...svg.querySelectorAll('[id]')].map(e => [e.id, e]))
		const containsImage = (node: Element, seen = new Set<string>()): boolean => {
			if (node.localName === 'image' || node.querySelector('image')) return true
			for (const use of [node, ...node.querySelectorAll('use')]) {
				if (use.localName !== 'use') continue
				const id = (use.getAttribute('href') || use.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '').slice(1)
				if (seen.has(id)) continue
				seen.add(id); const target = ids.get(id)
				if (target && containsImage(target, seen)) return true
			}
			return false
		}
		const pieces: VectorPiece[] = []
		for (const element of candidates) {
			const bounds = element.getBBox(), matrix = svg.getCTM()!.inverse().multiply(element.getCTM()!)
			const corners = [[bounds.x, bounds.y], [bounds.x + bounds.width, bounds.y], [bounds.x, bounds.y + bounds.height], [bounds.x + bounds.width, bounds.y + bounds.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix))
			const style = getComputedStyle(element)
			const padding = style.stroke === 'none' ? 0.05 : Math.max(1, (parseFloat(style.strokeWidth) || 1) * Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d)) * (parseFloat(style.strokeMiterlimit) || 4) / 2)
			const x = Math.max(vx, Math.min(...corners.map(p => p.x)) - padding), y = Math.max(vy, Math.min(...corners.map(p => p.y)) - padding)
			const right = Math.min(vx + width, Math.max(...corners.map(p => p.x)) + padding), bottom = Math.min(vy + height, Math.max(...corners.map(p => p.y)) + padding)
			if (right <= x || bottom <= y || style.display === 'none' || style.visibility === 'hidden') continue
			let fragment = element.cloneNode(true) as Element
			for (let parent = element.parentElement; parent && parent !== svg as unknown as Element; parent = parent.parentElement) { const ancestor = parent.cloneNode(false) as Element; ancestor.appendChild(fragment); fragment = ancestor }
			const root = svg.cloneNode(false) as SVGSVGElement
			root.setAttribute('viewBox', `${x} ${y} ${right - x} ${bottom - y}`)
			root.setAttribute('width', String(right - x)); root.setAttribute('height', String(bottom - y))
			const defs = document.createElementNS(NS, 'defs'), seen = new Set<string>()
			const dependencies = (node: Element) => {
				for (const current of [node, ...node.querySelectorAll('*')]) for (const attr of [...current.attributes]) {
					const references = attr.localName === 'href' && attr.value.startsWith('#') ? [attr.value.slice(1)] : [...attr.value.matchAll(/url\(['"]?#([^)'"\s]+)['"]?\)/g)].map(match => match[1])
					for (const id of references) { if (seen.has(id)) continue; seen.add(id); const definition = ids.get(id); if (!definition) throw new Error('A vector reference is missing.'); const copy = definition.cloneNode(true) as Element; defs.appendChild(copy); dependencies(copy) }
				}
			}
			dependencies(fragment); root.appendChild(defs); root.appendChild(fragment)
			pieces.push({ x: x - vx, y: y - vy, w: right - x, h: bottom - y, svg: new XMLSerializer().serializeToString(root), kind: containsImage(element) ? 'image' : textRun(element) || element.localName === 'text' ? 'text' : 'vector' })
		}
		const rasterPieces = pieces.filter(p => p.kind === 'image').length
		if (!pieces.some(p => p.kind === 'vector') || pieces.some(p => p.kind === 'image' && p.w * p.h > width * height * 0.85)) throw new Error('This appears to be a scanned/raster page, or has no selectable vector artwork. Scanned PDF import is not supported.')
		const preview = new XMLSerializer().serializeToString(svg)
		if (pieces.reduce((n, p) => n + p.svg.length, 0) > 25 * 1024 * 1024) throw new Error('The separated vectors are too large. Export a smaller drawing area.')
		return { width, height, pieces, preview, rasterPieces }
	} finally { host.remove() }
}

/** One native transaction; SVG assets retain vector detail and native grouping/clipboard behavior. */
export function insertVectorPage(editor: Editor, page: VectorPage, name: string) {
	if (editor.getIsReadonly()) throw new Error('This canvas is read-only.')
	if (editor.getCurrentPageShapes().length + page.pieces.length + 2 > editor.options.maxShapesPerPage) throw new Error('Not enough room on this canvas page. Create a new page and import there.')
	const center = editor.getViewportPageBounds().center, frame = createShapeId()
	const assets: TLAsset[] = [], shapes: TLShapePartial[] = []
	const addImage = (piece: Pick<VectorPiece, 'x' | 'y' | 'w' | 'h' | 'svg'>, label: string, locked = false) => {
		const assetId = AssetRecordType.createId()
		assets.push({ id: assetId, typeName: 'asset', type: 'image', meta: {}, props: { name: label, src: svgDataUrl(piece.svg), w: piece.w, h: piece.h, mimeType: 'image/svg+xml', isAnimated: false } })
		shapes.push({ id: createShapeId(), type: 'image', parentId: frame, x: piece.x, y: piece.y, isLocked: locked, props: { assetId, w: piece.w, h: piece.h }, meta: { basName: label, basPdfPiece: !locked } })
	}
	addImage({ x: 0, y: 0, w: page.width, h: page.height, svg: `<svg xmlns="${NS}" width="${page.width}" height="${page.height}"><rect width="100%" height="100%" fill="white"/></svg>` }, `${name} paper`, true)
	page.pieces.forEach((piece, i) => addImage(piece, `${name} ${piece.kind} ${i + 1}`))
	editor.markHistoryStoppingPoint('import vector PDF page')
	editor.run(() => {
		editor.createAssets(assets)
		editor.createShape({ id: frame, type: 'frame', x: center.x - page.width / 2, y: center.y - page.height / 2, props: { w: page.width, h: page.height, name }, meta: { basName: name } })
		editor.createShapes(shapes)
		editor.setCurrentTool('select'); editor.select(frame)
	})
	editor.zoomToSelection({ animation: { duration: 200 } })
	return { frame, pieces: shapes.slice(1).map(s => s.id as TLShapeId) }
}
