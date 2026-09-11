import type { Editor, TLShape } from 'tldraw'
import { useRef, type ReactNode } from 'react'
import { useRuntimeValues } from './runtimeAnimationHooks'
import { bindingsForRenderedShape } from './bindingScope'
import { getRuntimeShapePresentation } from './runtimeMapping'
import { SynchronizedHtmlMotion } from './RuntimeMotion'
import { formatSnapshot, labelColorStyle, labelFontStyle, labelPositionStyle, labelStatusTextColor, snapshotState } from './labelPresentation'
import type { LabelPlacement, PointSnapshot, ShapeBinding } from './types'

export function labelStacks(bindings: ShapeBinding[]) {
	const stacks = new Map<string, { shapeId: string; placement: LabelPlacement; labels: ShapeBinding[] }>()
	for (const binding of bindings) {
		if (binding.enabled === false || binding.runtimeProperty !== 'label') continue
		const placement = binding.options?.kind === 'label' ? binding.options.placement : 'bottom'
		const key = JSON.stringify([binding.shapeId, placement])
		if (!stacks.has(key)) stacks.set(key, { shapeId: binding.shapeId, placement, labels: [] })
		stacks.get(key)!.labels.push(binding)
	}
	return stacks
}

export function RuntimeValueLabels({ editor, shapes, bindings, snapshots, zoom }: {
	editor: Editor; shapes: TLShape[]; bindings: ShapeBinding[]; snapshots: Record<string, PointSnapshot>; zoom: number
}) {
	const byId = new Map<string, TLShape>(shapes.map((shape) => [shape.id, shape]))
	return <>{[...labelStacks(bindings)].map(([key, stack]) => {
		const shape = byId.get(stack.shapeId)
		if (!shape) return null
		const bounds = editor.getShapePageBounds(shape)
		if (!bounds) return null
		const presentation = getRuntimeShapePresentation(bindingsForRenderedShape(editor, shape, bindings), snapshots)
		if (presentation.visible === false) return null
		const topLeft = editor.pageToViewport(bounds)
		const style = labelPositionStyle(topLeft.x, topLeft.y, bounds.w * zoom, bounds.h * zoom, stack.placement, 0, 1)
		const visible = stack.labels.filter((binding) => snapshots[binding.pointReference])
		return <div key={key} className="runtime-label-anchor" style={style}>
			<LabelTranslation x={presentation.translation?.x ?? 0} y={presentation.translation?.y ?? 0} opacity={presentation.opacity ?? 1} zoom={zoom}>
			<SynchronizedHtmlMotion motion={presentation.motion} motions={presentation.motions?.map((motion) => ({ ...motion, x: motion.x * zoom, y: motion.y * zoom }))}>
				<div className="runtime-label-stack" style={{ display: 'flex', flexDirection: stack.placement === 'top' ? 'column-reverse' : 'column', alignItems: stack.placement === 'left' ? 'flex-end' : stack.placement === 'right' ? 'flex-start' : 'center' }}>
					{visible.map((binding, index) => {
						const snapshot = snapshots[binding.pointReference]
						const options = binding.options?.kind === 'label' ? binding.options : { kind: 'label' as const, placement: 'bottom' as const, gap: 5 }
						const separation = (index ? options.stackGap ?? 4 : stack.placement === 'top' || stack.placement === 'bottom' ? options.gap : 0) * zoom
						return <span key={binding.id} data-binding-id={binding.id} className="runtime-label" data-state={snapshotState(snapshot)} data-color-mode={options.colorMode || 'status'} data-background={options.background || 'solid'} style={{
							...labelColorStyle(options.colorMode, options.color), ...labelFontStyle(editor, shape),
							fontSize: (options.fontSize ?? 20) * zoom, padding: options.background === 'none' ? 0 : `${4 * zoom}px ${7 * zoom}px`,
							borderWidth: options.background === 'none' ? 0 : zoom, borderRadius: (options.cornerRadius ?? 12) * zoom,
							marginTop: stack.placement !== 'top' ? separation : 0, marginBottom: stack.placement === 'top' ? separation : 0,
							marginLeft: stack.placement === 'right' ? options.gap * zoom : 0, marginRight: stack.placement === 'left' ? options.gap * zoom : 0,
							boxShadow: `0 ${3 * zoom}px ${10 * zoom}px rgb(0 0 0 / 14%)`,
							...(options.background === 'none' ? { backgroundColor: 'transparent', boxShadow: 'none', color: options.colorMode === 'custom' ? options.color : labelStatusTextColor(snapshot) } : {}),
						}}>{options.caption ? `${options.caption}: ` : ''}{formatSnapshot(snapshot)}</span>
					})}
				</div>
			</SynchronizedHtmlMotion>
			</LabelTranslation>
		</div>
	})}</>
}

function LabelTranslation({ x, y, opacity, zoom, children }: { x: number; y: number; opacity: number; zoom: number; children: ReactNode }) {
	const ref = useRef<HTMLDivElement>(null)
	useRuntimeValues({ x, y, opacity }, values => {
		if (!ref.current) return
		ref.current.style.transform = `translate(${values.x * zoom}px, ${values.y * zoom}px)`
		ref.current.style.opacity = String(values.opacity)
	})
	return <div ref={ref}>{children}</div>
}
