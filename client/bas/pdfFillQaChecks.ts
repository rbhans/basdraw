import { addClosedOutlineInteriors, closedSubpaths, pdfFillSource } from './pdfFillArtwork'
import { svgDataUrl } from './vectorPdfImport'
import type { TLAsset } from 'tldraw'

// Actual E/C outline from the user's imported control drawing: a diagonal followed
// by a rectangle returning to its start, with no closepath command and no fill.
export const coilOutlineSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="20.4" height="20.4" viewBox="453.35859375 265.1984298706055 20.4 20.4"><path fill="none" stroke-width="0.32" stroke="black" d="M 630.078125 355.197917 L 606.078125 379.197917 M 606.078125 379.197917 L 630.078125 379.197917 L 630.078125 355.197917 L 606.078125 355.197917 L 606.078125 379.197917" transform="matrix(0.75,0,0,0.75,0,0)"/></svg>'

export async function checkPdfFillInteriors() {
	const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }
	const raster = async (source: string) => {
		const img = new Image(); img.src = svgDataUrl(source); await img.decode()
		const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 200
		const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0, 200, 200)
		return (x: number, y: number) => ctx.getImageData(x, y, 1, 1).data[3]
	}
	const original = await raster(coilOutlineSvg)
	assert(original(70, 70) === 0, 'Coil fixture must reproduce an empty interior')
	const filled = await raster(addClosedOutlineInteriors(coilOutlineSvg))
	assert(filled(70, 70) === 255 && filled(130, 130) === 255, 'Both sides of the actual coil must fill')
	assert(filled(2, 2) === 0, 'Coil image padding must stay transparent')
	const wrap = (content: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">${content}</svg>`
	const open = await raster(addClosedOutlineInteriors(wrap('<path fill="none" stroke="black" d="M10 10 L90 10 L90 90"/>')))
	assert(open(140, 80) === 0, 'Open pipe must not become a filled triangle')
	const compound = await raster(addClosedOutlineInteriors(wrap('<path fill="none" fill-rule="evenodd" stroke="black" d="M10 10 H90 V90 H10 Z M30 30 H70 V70 H30 Z"/>')))
	assert(compound(40, 40) === 255 && compound(100, 100) === 0, 'Compound contour holes must survive')
	const clipped = await raster(addClosedOutlineInteriors(wrap('<defs><clipPath id="half"><rect width="50" height="100"/></clipPath></defs><g clip-path="url(#half)" fill="none"><rect x="10" y="10" width="80" height="80" stroke="black"/></g>')))
	assert(clipped(40, 40) === 255 && clipped(140, 40) === 0, 'Inherited fill and clipping must survive')
	assert(!closedSubpaths('M10 10 L30 40'), 'A diagonal must remain open')
	const relative = closedSubpaths('M10 10 L20 20 m10 10 20 0 0 20 -20 0 z')
	assert(relative.startsWith('M30 30 l'), 'Relative moveto and implicit lineto must retain position')
	assert(closedSubpaths('M20 50 a30 30 0 1 0 60 0 a30 30 0 1 0 -60 0'), 'Closed arcs must fill without Z')
	const asset = { type: 'image', props: { src: svgDataUrl(coilOutlineSvg) } } as TLAsset
	const source = pdfFillSource(asset)
	assert(source !== asset.props.src && asset.props.src === svgDataUrl(coilOutlineSvg), 'Saved SVG must remain unchanged')
	assert(pdfFillSource(asset) === source, 'Derived mask should be cached across live updates')
	return 'Actual outline-only coil fills on both sides; padding, open pipes, compound holes, clipping, relative paths and saved artwork preserved'
}
