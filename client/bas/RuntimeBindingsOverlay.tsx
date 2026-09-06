import { resolveBehaviorChannels } from './behaviorDefinitions'
import { RuntimeValueLabels } from './RuntimeValueLabels'
import { snapshotState } from './labelPresentation'
export { formatSnapshot } from './labelPresentation'
import type { CSSProperties, ReactNode } from 'react'
import { Geometry2d, Mat, type Editor, type TLShape, useEditor, useValue } from 'tldraw'
import { useBasRuntime } from './BasRuntimeContext'
import { bindingsForRenderedShape, groupLeafShapes, pageVectorInShapeSpace, transformOriginForBindings } from './bindingScope'
import { evaluateBinding, getRuntimeShapePresentation, type RuntimeShapePresentation } from './runtimeMapping'
import { SynchronizedSvgMotion } from './SynchronizedMotion'
import { SynchronizedSvgSpin } from './SynchronizedSpin'
import type { PointSnapshot, ShapeBinding } from './types'

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
	if (!paths.length) return null
	const bindings = bindingsForRenderedShape(editor, shape, allBindings)
	const presentation = getRuntimeShapePresentation(bindings, snapshots)
	const center = transformOriginForBindings(editor, shape, bindings, geometry.bounds.center)
	const scaleCenter = transformOriginForBindings(editor, shape, bindings, geometry.bounds.center, 'scale')
	const viewportTransform = shapeViewportTransform(editor, shape, view)
	const content = binding.runtimeProperty === 'levelFill'
		? levelFillContent(binding, snapshot, paths, geometry.bounds, `level-fill-${safeId(binding.id)}`)
		: paths.map((path, index) => (
			<path key={index} d={path.d} data-fill={path.filled} vectorEffect="non-scaling-stroke" />
		))
	if (!content) return null

	return (
		<svg className={`runtime-fill ${binding.runtimeProperty === 'levelFill' ? 'runtime-level-fill' : ''}`} data-state={snapshotState(snapshot)}>
			<g transform={viewportTransform.toCssString()} opacity={presentation.opacity} visibility={presentation.visible === false ? 'hidden' : undefined}>
				<RuntimeSvgTransform center={center} scaleCenter={scaleCenter} presentation={{ ...presentation, translation: pageVectorInShapeSpace(editor, shape, presentation.translation), motions: presentation.motions?.map((motion) => ({ ...motion, ...pageVectorInShapeSpace(editor, shape, motion) })), motion: presentation.motion ? { ...presentation.motion, ...pageVectorInShapeSpace(editor, shape, presentation.motion) } : undefined }}>{content}</RuntimeSvgTransform>
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
	const descendantPaths = groupLeafShapes(editor, shape).filter((child) => bindingsForRenderedShape(editor, child, allBindings).some((candidate) => candidate.id === binding.id)).flatMap((child) => {
		const transform = shapeViewportTransform(editor, child, view).toCssString()
		return geometryPaths(editor.getShapeGeometry(child)).map((path) => ({ ...path, transform }))
	})
	if (!descendantPaths.length) return null

	let content: ReactNode
	if (binding.runtimeProperty === 'levelFill') {
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
				<rect
					className="runtime-level-rect"
					x={bounds.x}
					y={bounds.y}
					width={bounds.w}
					height={bounds.h}
					clipPath={`url(#${clipId})`}
					fill={options.color}
					style={levelFillStyle(options.direction, output)}
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
			<g opacity={presentation.opacity} visibility={presentation.visible === false ? 'hidden' : undefined}>
				<RuntimeSvgTransform center={center} scaleCenter={scaleCenter} presentation={scalePresentation(presentation, view.zoom)}>{content}</RuntimeSvgTransform>
			</g>
		</svg>
	)
}

function RuntimeSvgTransform({ center, scaleCenter, children, presentation }: {
	center: { x: number; y: number }
	scaleCenter: { x: number; y: number }
	children: ReactNode
	presentation: RuntimeShapePresentation
}) {
	return (
		<SynchronizedSvgMotion motion={presentation.motion} motions={presentation.motions}>
			<g transform={runtimeTransform(center, presentation)}>
				<SynchronizedSvgSpin center={center} spin={presentation.spin}><g transform={presentation.scale != null ? `translate(${scaleCenter.x} ${scaleCenter.y}) scale(${presentation.scale}) translate(${-scaleCenter.x} ${-scaleCenter.y})` : undefined}>{children}</g></SynchronizedSvgSpin>
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
			<rect
				className="runtime-level-rect"
				x={bounds.x}
				y={bounds.y}
				width={bounds.w}
				height={bounds.h}
				clipPath={`url(#${clipId})`}
				fill={options.color}
				style={levelFillStyle(options.direction, output)}
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

function runtimeTransform(center: { x: number; y: number }, presentation: RuntimeShapePresentation) {
	return [
		presentation.translation ? `translate(${presentation.translation.x} ${presentation.translation.y})` : '',
		`translate(${center.x} ${center.y})`,
		presentation.rotation != null ? `rotate(${presentation.rotation})` : '',
		`translate(${-center.x} ${-center.y})`,
	].filter(Boolean).join(' ')
}

function scalePresentation(presentation: RuntimeShapePresentation, zoom: number): RuntimeShapePresentation {
	return {
		...presentation,
		motions: presentation.motions?.map((motion) => ({ ...motion, x: motion.x * zoom, y: motion.y * zoom })),
		translation: presentation.translation ? scaleVector(presentation.translation, zoom) : undefined,
		motion: presentation.motion
			? { ...scaleVector(presentation.motion, zoom), secondsPerCycle: presentation.motion.secondsPerCycle }
			: undefined,
	}
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
