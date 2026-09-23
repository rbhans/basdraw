/**
 * A 2D affine matrix in the same shape as tldraw's `MatModel`.
 * Maps a point (x, y) to (a*x + c*y + e, b*x + d*y + f).
 */
export interface AffineMatrix {
	a: number
	b: number
	c: number
	d: number
	e: number
	f: number
}

export interface Point {
	x: number
	y: number
}

export function applyMatrixToPoint(m: AffineMatrix, point: Point): Point {
	return { x: m.a * point.x + m.c * point.y + m.e, y: m.b * point.x + m.d * point.y + m.f }
}

/**
 * Convert a page-space point into the space of a parent whose page transform is `parentPageTransform`.
 * A null transform means the parent is the page, so the point is returned unchanged.
 */
export function pagePointToParentSpace(point: Point, parentPageTransform: AffineMatrix | null): Point {
	if (!parentPageTransform) return { x: point.x, y: point.y }
	const { a, b, c, d, e, f } = parentPageTransform
	const determinant = a * d - b * c
	if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
		// A degenerate parent can't be inverted; fall back to removing its translation only.
		return { x: point.x - e, y: point.y - f }
	}
	const x = point.x - e
	const y = point.y - f
	return { x: (d * x - c * y) / determinant, y: (-b * x + a * y) / determinant }
}

/**
 * Resolve a parent-space position from optional page-space coordinates.
 * Missing coordinates fall back to the shape's current position, so a partial
 * update never mixes page-space and parent-space values.
 */
export function resolveParentSpacePosition(
	page: { x?: number | null; y?: number | null },
	fallbackLocal: Point,
	parentPageTransform: AffineMatrix | null
): Point {
	const hasX = typeof page.x === 'number'
	const hasY = typeof page.y === 'number'
	if (!hasX && !hasY) return { x: fallbackLocal.x, y: fallbackLocal.y }
	const fallbackPage = parentPageTransform
		? applyMatrixToPoint(parentPageTransform, fallbackLocal)
		: fallbackLocal
	return pagePointToParentSpace(
		{ x: hasX ? (page.x as number) : fallbackPage.x, y: hasY ? (page.y as number) : fallbackPage.y },
		parentPageTransform
	)
}
