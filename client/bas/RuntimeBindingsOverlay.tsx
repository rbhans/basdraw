import { resolveBehaviorChannels } from './behaviorDefinitions'
import { RuntimeValueLabels } from './RuntimeValueLabels'
import { snapshotState } from './labelPresentation'
export { formatSnapshot } from './labelPresentation'
import { useRef, type CSSProperties, type ReactNode } from 'react'
import { Geometry2d, Mat, type Editor, type TLShape, useEditor, useValue } from 'tldraw'
import { useBasRuntime } from './BasRuntimeContext'
import { bindingsForRenderedShape, groupLeafShapes, pageVectorInShapeSpace, transformOriginForBindings } from './bindingScope'
import { evaluateBinding, getRuntimeShapePresentation, type RuntimeShapePresentation } from './runtimeMapping'
import { SynchronizedSvgMotion, SynchronizedSvgSpin } from './RuntimeMotion'
import { useRuntimeValues } from './runtimeAnimationHooks'
import type { PointSnapshot, ShapeBinding } from './types'
import { pdfFillSource } from './pdfFillArtwork'

type OverlayView = {
	camera: { x: number; y: number }
	zoom: number
}

export function RuntimeBindingsOverlay() {
	const editor = useEditor()
	const { document, snapshots } = useBasRuntime()
	useValue('runtime overlay camera', () => editor.getCamera(), [editor])
	useValue('runtime overlay page', () => editor.getCurrentPageId(), [editor])
	const pageShapes = useValue('runtime overlay shapes', () => editor.getCurrentPageShapes(), [editor])
	const camera = editor.getCamera()
	const view = { camera, zoom: camera.z }

	return (
		<div className="runtime-overlay-layer" aria-hidden="true">
			{document.bindings.map((binding) => {
				const shape = pageShapes.find((candidate) => candidate.id === binding.shapeId)
				const snapshot = snapshots[binding.pointReference]
				if (!shape || !snapshot) return null
				const ownBindings = resolveBehaviorChannels(document.bindings.filter((candidate) => candidate.shapeId === binding.shapeId))
				if (!ownBindings.some((candidate) => candidate.id === binding.id)) return null
				const shapeBindings = bindingsForRenderedShape(editor, shape, document.bindings)
				const presentation = getRuntimeShapePresentation(shapeBindings, snapshots)

				if (binding.runtimeProperty === 'fill' || binding.runtimeProperty === 'levelFill') {
					return shape.type === 'group'
						? <GroupFillOverlay key={binding.id} editor={editor} shape={shape} binding={binding} snapshot={snapshot} presentation={presentation} bindings={shapeBindings} allBindings={document.bindings} view={view} />
						: <ShapeFillOverlay key={binding.id} editor={editor} shape={shape} binding={binding} snapshot={snapshot} allBindings={document.bindings} snapshots={snapshots} view={view} />
				}

				return null
			})}
			<RuntimeValueLabels editor={editor} shapes={pageShapes} bindings={document.bindings} snapshots={snapshots} zoom={view.zoom} />
		</div>
	)
}

function ShapeFillOverlay({
	editor,
	shape,
	binding,
	snapshot,
	allBindings,
	snapshots,
	view,
}: {
	editor: Editor
	shape: TLShape
	binding: ShapeBinding
	snapshot: PointSnapshot
	allBindings: ShapeBinding[]
	snapshots: Record<string, PointSnapshot>
	view: OverlayView
}) {
	const geometry = editor.getShapeGeometry(shape)
	const paths = geometryPaths(geometry)
	const bindings = bindingsForRenderedShape(editor, shape, allBindings)
	const presentation = getRuntimeShapePresentation(bindings, snapshots)
	const center = transformOriginForBindings(editor, shape, bindings, geometry.bounds.center)
	const scaleCenter = transformOriginForBindings(editor, shape, bindings, geometry.bounds.center, 'scale')
	const viewportTransform = shapeViewportTransform(editor, shape, view)
	const artwork = pdfArtwork(editor, shape)
	if (!artwork && !paths.length) return null
	const content = artwork ? maskedPdfFill(binding, snapshot, artwork, geometry.bounds, `pdf-fill-${safeId(binding.id)}`) : binding.runtimeProperty === 'levelFill'
		? levelFillContent(binding, snapshot, paths, geometry.bounds, `level-fill-${safeId(binding.id)}`)
		: paths.map((path, index) => (
			<path key={index} d={path.d} data-fill={path.filled} vectorEffect="non-scaling-stroke" />
		))
	if (!content) return null

	return (
		<svg className={`runtime-fill ${binding.runtimeProperty === 'levelFill' ? 'runtime-level-fill' : ''}`} data-state={snapshotState(snapshot)}>
			<g transform={viewportTransform.toCssString()} visibility={presentation.visible === false ? 'hidden' : undefined}>
				<RuntimeSvgTransform center={center} scaleCenter={scaleCenter} presentation={presentation} project={vector => pageVectorInShapeSpace(editor, shape, vector)}>{content}</RuntimeSvgTransform>
			</g>
		</svg>
	)
}

function GroupFillOverlay({
	editor,
	shape,
	binding,
	snapshot,
	presentation,
	bindings,
	allBindings,
	view,
}: {
	editor: Editor
	shape: TLShape
	binding: ShapeBinding
	snapshot: PointSnapshot
	presentation: RuntimeShapePresentation
	bindings: ShapeBinding[]
	allBindings: ShapeBinding[]
	view: OverlayView
}) {
	const groupBounds = editor.getShapePageBounds(shape)
	if (!groupBounds) return null
	const leaves = groupLeafShapes(editor, shape).filter((child) => bindingsForRenderedShape(editor, child, allBindings).some((candidate) => candidate.id === binding.id))
	const hasPdfArtwork = leaves.some((child) => child.meta.basPdfPiece === true && pdfArtwork(editor, child))
	const topLeft = editor.pageToViewport({ x: groupBounds.x, y: groupBounds.y })
	const bounds = {
		x: topLeft.x,
		y: topLeft.y,
		w: groupBounds.w * view.zoom,
		h: groupBounds.h * view.zoom,
	}
	const scaleCenter = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 }
	const localPivot = transformOriginForBindings(editor, shape, bindings, editor.getShapeGeometry(shape).bounds.center)
	const center = editor.pageToViewport(editor.getShapePageTransform(shape).applyToPoint(localPivot))
	const descendantPaths = leaves.flatMap((child) => {
		const transform = shapeViewportTransform(editor, child, view).toCssString()
		return geometryPaths(editor.getShapeGeometry(child)).map((path) => ({ ...path, transform }))
	})
	if (!descendantPaths.length && !hasPdfArtwork) return null

	let content: ReactNode
	if (leaves.some(child => child.meta.basPdfPiece === true)) {
		const artwork = leaves.map(child => <g key={child.id} transform={shapeViewportTransform(editor, child, view).toCssString()}>{pdfArtwork(editor, child) || geometryPaths(editor.getShapeGeometry(child)).filter(path => path.filled).map((path, i) => <path key={i} d={path.d} style={{ fill: 'white', stroke: 'none', opacity: 1 }} />)}</g>)
		content = maskedPdfFill(binding, snapshot, artwork, bounds, `pdf-group-fill-${safeId(binding.id)}`)
	} else if (binding.runtimeProperty === 'levelFill') {
		const output = evaluateBinding(binding, snapshot)
		if (output == null || !Number.isFinite(output)) return null
		const closedPaths = descendantPaths.filter((path) => path.filled)
		if (!closedPaths.length) return null
		const options = binding.options?.kind === 'levelFill'
			? binding.options
			: { kind: 'levelFill' as const, color: '#2f80ed', direction: 'up' as const }
		const clipId = `group-level-fill-${safeId(binding.id)}`
		content = (
			<>
				<defs>
					<clipPath id={clipId} clipPathUnits="userSpaceOnUse">
						{closedPaths.map((path, index) => <path key={index} d={path.d} transform={path.transform} />)}
					</clipPath>
				</defs>
				<AnimatedLevelRect
					className="runtime-level-rect"
					x={bounds.x}
					y={bounds.y}
					width={bounds.w}
					height={bounds.h}
					clipPath={`url(#${clipId})`}
					fill={options.color}
					direction={options.direction} output={output}
				/>
			</>
		)
	} else {
		content = descendantPaths.map((path, index) => (
			<path key={index} d={path.d} transform={path.transform} data-fill={path.filled} vectorEffect="non-scaling-stroke" />
		))
	}

	return (
		<svg className={`runtime-fill ${binding.runtimeProperty === 'levelFill' ? 'runtime-level-fill' : ''}`} data-state={snapshotState(snapshot)}>
			<g visibility={presentation.visible === false ? 'hidden' : undefined}>
				<RuntimeSvgTransform center={center} scaleCenter={scaleCenter} presentation={presentation} project={vector => scaleVector(vector, view.zoom)}>{content}</RuntimeSvgTransform>
			</g>
		</svg>
	)
}

/** Cover painted artwork plus enclosed outlines, never the image bounding rectangle. */
function pdfArtwork(editor: Editor, shape: TLShape): ReactNode {
	if (shape.type !== 'image' || shape.meta.basPdfPiece !== true || !shape.props.assetId) return null
	const asset = editor.getAsset(shape.props.assetId)
	if (asset?.type !== 'image' || !asset.props.src) return null
	const source = pdfFillSource(asset)
	const { w, h, crop, flipX, flipY } = shape.props
	const left = crop?.topLeft.x || 0, top = crop?.topLeft.y || 0
	const width = w / Math.max(0.001, (crop?.bottomRight.x ?? 1) - left), height = h / Math.max(0.001, (crop?.bottomRight.y ?? 1) - top)
	return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} overflow="hidden"><g transform={`translate(${flipX ? w : 0} ${flipY ? h : 0}) scale(${flipX ? -1 : 1} ${flipY ? -1 : 1})`}><image href={source!} x={-left * width} y={-top * height} width={width} height={height} preserveAspectRatio="none" /></g></svg>
}

function maskedPdfFill(binding: ShapeBinding, snapshot: PointSnapshot, artwork: ReactNode, bounds: { x: number; y: number; w: number; h: number }, id: string) {
	const output = evaluateBinding(binding, snapshot)
	if (binding.runtimeProperty === 'levelFill' && (output == null || !Number.isFinite(output))) return null
	const options = binding.options?.kind === 'levelFill' ? binding.options : { color: '#2f80ed', direction: 'up' as const }
	return <><defs><mask id={id} maskUnits="userSpaceOnUse" x={bounds.x} y={bounds.y} width={bounds.w} height={bounds.h} ref={(element) => { element?.setAttribute('mask-type', 'alpha') }} style={{ maskType: 'alpha' }}>{artwork}</mask></defs><g mask={`url(#${id})`}>
		{binding.runtimeProperty === 'levelFill' ? <AnimatedLevelRect className="runtime-level-rect" x={bounds.x} y={bounds.y} width={bounds.w} height={bounds.h} fill={options.color} direction={options.direction} output={output!} /> : <path data-fill="true" d={`M${bounds.x} ${bounds.y}h${bounds.w}v${bounds.h}h${-bounds.w}Z`} />}
	</g></>
}

function RuntimeSvgTransform({ center, scaleCenter, children, presentation, project }: {
	center: { x: number; y: number }
	scaleCenter: { x: number; y: number }
	children: ReactNode
	presentation: RuntimeShapePresentation
	project: (vector: { x: number; y: number }) => { x: number; y: number }
}) {
	const transform = useRef<SVGGElement>(null), scaled = useRef<SVGGElement>(null)
	useRuntimeValues({ x: presentation.translation?.x ?? 0, y: presentation.translation?.y ?? 0, rotation: presentation.rotation ?? 0, scale: presentation.scale ?? 1, opacity: presentation.opacity ?? 1 }, values => {
		transform.current?.setAttribute('transform', runtimeTransform(center, { translation: project({ x: values.x, y: values.y }), rotation: values.rotation }))
		transform.current?.setAttribute('opacity', String(values.opacity))
		scaled.current?.setAttribute('transform', `translate(${scaleCenter.x} ${scaleCenter.y}) scale(${values.scale}) translate(${-scaleCenter.x} ${-scaleCenter.y})`)
	})
	return (
		<SynchronizedSvgMotion motion={presentation.motion ? { ...presentation.motion, ...project(presentation.motion) } : undefined} motions={presentation.motions?.map(motion => ({ ...motion, ...project(motion) }))}>
			<g ref={transform}>
				<SynchronizedSvgSpin center={center} spin={presentation.spin}><g ref={scaled}>{children}</g></SynchronizedSvgSpin>
			</g>
		</SynchronizedSvgMotion>
	)
}

function levelFillContent(
	binding: ShapeBinding,
	snapshot: PointSnapshot,
	paths: Array<{ d: string; filled: boolean }>,
	bounds: { x: number; y: number; w: number; h: number },
	clipId: string,
) {
	const output = evaluateBinding(binding, snapshot)
	if (output == null || !Number.isFinite(output)) return null
	const closedPaths = paths.filter((path) => path.filled)
	if (!closedPaths.length) return null
	const options = binding.options?.kind === 'levelFill'
		? binding.options
		: { kind: 'levelFill' as const, color: '#2f80ed', direction: 'up' as const }
	return (
		<>
			<defs>
				<clipPath id={clipId} clipPathUnits="userSpaceOnUse">
					{closedPaths.map((path, index) => <path key={index} d={path.d} />)}
				</clipPath>
			</defs>
			<AnimatedLevelRect
				className="runtime-level-rect"
				x={bounds.x}
				y={bounds.y}
				width={bounds.w}
				height={bounds.h}
				clipPath={`url(#${clipId})`}
				fill={options.color}
				direction={options.direction} output={output}
			/>
		</>
	)
}

function shapeViewportTransform(editor: Editor, shape: TLShape, view: OverlayView) {
	const pageTransform = editor.getShapePageTransform(shape)
	return new Mat(
		pageTransform.a * view.zoom,
		pageTransform.b * view.zoom,
		pageTransform.c * view.zoom,
		pageTransform.d * view.zoom,
		(pageTransform.e + view.camera.x) * view.zoom,
		(pageTransform.f + view.camera.y) * view.zoom,
	)
}

function AnimatedLevelRect({ direction, output, ...props }: React.SVGProps<SVGRectElement> & { direction: 'up' | 'down' | 'left' | 'right'; output: number }) {
	const ref = useRef<SVGRectElement>(null)
	useRuntimeValues({ level: Math.min(100, Math.max(0, output)) }, values => {
		if (ref.current) Object.assign(ref.current.style, levelFillStyle(direction, values.level))
	})
	return <rect ref={ref} {...props} />
}

function runtimeTransform(center: { x: number; y: number }, presentation: RuntimeShapePresentation) {
	return [
		presentation.translation ? `translate(${presentation.translation.x} ${presentation.translation.y})` : '',
		`translate(${center.x} ${center.y})`,
		presentation.rotation != null ? `rotate(${presentation.rotation})` : '',
		`translate(${-center.x} ${-center.y})`,
	].filter(Boolean).join(' ')
}

function scaleVector(vector: { x: number; y: number } | undefined, scale: number) {
	return vector ? { x: vector.x * scale, y: vector.y * scale } : { x: 0, y: 0 }
}

function safeId(id: string) {
	return id.replace(/[^a-zA-Z0-9_-]/g, '')
}

function levelFillStyle(direction: 'up' | 'down' | 'left' | 'right', output: number): CSSProperties {
	const progress = Math.min(100, Math.max(0, output)) / 100
	if (direction === 'up') return { transform: `scaleY(${progress})`, transformOrigin: 'center bottom', transformBox: 'fill-box' }
	if (direction === 'down') return { transform: `scaleY(${progress})`, transformOrigin: 'center top', transformBox: 'fill-box' }
	if (direction === 'left') return { transform: `scaleX(${progress})`, transformOrigin: 'right center', transformBox: 'fill-box' }
	return { transform: `scaleX(${progress})`, transformOrigin: 'left center', transformBox: 'fill-box' }
}

function geometryPaths(geometry: Geometry2d): Array<{ d: string; filled: boolean }> {
	if (geometry.isLabel || geometry.isInternal) return []
	if ('children' in geometry && Array.isArray(geometry.children)) {
		return geometry.children.flatMap((child) => geometryPaths(child))
	}
	const d = geometry.getSvgPathData(true)
	return d ? [{ d, filled: geometry.isClosed }] : []
}
