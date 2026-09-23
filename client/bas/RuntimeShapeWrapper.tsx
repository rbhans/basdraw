import { forwardRef, useMemo, useRef, type ReactNode } from 'react'
import { DefaultShapeWrapper, type TLShapeWrapperProps, type TLShape, useEditor } from 'tldraw'
import type { ShapeBinding } from './types'
import { useBasRuntime, useRuntimeSnapshots } from './BasRuntimeContext'
import { bindingsForRenderedShape, pageVectorInShapeSpace, transformOriginForBindings } from './bindingScope'
import { getRuntimeShapePresentation } from './runtimeMapping'
import { SynchronizedHtmlMotion, SynchronizedHtmlSpin } from './RuntimeMotion'
import { useRuntimeValues } from './runtimeAnimationHooks'

export const RuntimeShapeWrapper = forwardRef(function RuntimeShapeWrapper(
	{ children, shape, isBackground, ...props }: TLShapeWrapperProps,
	ref: React.Ref<HTMLDivElement>,
) {
	return <DefaultShapeWrapper ref={ref} shape={shape} isBackground={isBackground} {...props}>
		<RuntimeShapeDecorator shape={shape}>{children}</RuntimeShapeDecorator>
	</DefaultShapeWrapper>
})

/**
 * Always renders the same wrapper tree. Gaining or losing bindings, connecting,
 * disconnecting or starting/stopping motion only repaints; it never remounts the
 * shape content (web view iframes reload and charts reset when they remount).
 */
export function RuntimeShapeDecorator({ shape, children }: { shape: TLShape; children: ReactNode }) {
	const editor = useEditor()
	const { bindingsByShape } = useBasRuntime()
	const bindings = bindingsForRenderedShape(editor, shape, bindingsByShape)
	return <RuntimeShapeContent shape={shape} bindings={bindings}>{children}</RuntimeShapeContent>
}

const IDENTITY = { x: 0, y: 0, rotation: 0, scale: 1, opacity: 1 }

function RuntimeShapeContent({ shape, bindings, children }: { shape: TLShape; bindings: ShapeBinding[]; children: ReactNode }) {
	const editor = useEditor()
	const pointKey = bindings.map((binding) => binding.pointReference).join('\n')
	const points = useMemo(() => pointKey ? [...new Set(pointKey.split('\n'))] : [], [pointKey])
	const snapshots = useRuntimeSnapshots(points)
	const active = bindings.length > 0
	const presentation = active ? getRuntimeShapePresentation(bindings, snapshots) : {}
	const geometry = active ? editor.getShapeGeometry(shape) : null
	const transformOrigin = geometry ? transformOriginForBindings(editor, shape, bindings, geometry.bounds.center) : { x: 0, y: 0 }
	const scaleOrigin = geometry ? transformOriginForBindings(editor, shape, bindings, geometry.bounds.center, 'scale') : { x: 0, y: 0 }
	const content = useRef<HTMLDivElement>(null), transform = useRef<HTMLDivElement>(null), scaled = useRef<HTMLDivElement>(null)
	useRuntimeValues(active ? { x: presentation.translation?.x ?? 0, y: presentation.translation?.y ?? 0, rotation: presentation.rotation ?? 0, scale: presentation.scale ?? 1, opacity: presentation.opacity ?? 1 } : IDENTITY, values => {
		// Unbound shapes keep the wrapper but carry no transform, opacity or stacking context.
		const translation = active ? pageVectorInShapeSpace(editor, shape, { x: values.x, y: values.y }) : null
		if (content.current) content.current.style.opacity = translation ? String(values.opacity) : ''
		if (transform.current) transform.current.style.transform = translation ? `translate(${translation.x}px, ${translation.y}px) rotate(${values.rotation}deg)` : ''
		if (scaled.current) scaled.current.style.transform = translation ? `scale(${values.scale})` : ''
	}, active)

	return (
		<div ref={content} className="runtime-shape-content" style={{ visibility: presentation.visible === false ? 'hidden' : undefined }}>
			<SynchronizedHtmlMotion motions={presentation.motions?.map((item) => ({ ...item, ...pageVectorInShapeSpace(editor, shape, item) }))}>
				<div ref={transform} className="runtime-shape-transform" style={{ transformOrigin: `${transformOrigin.x}px ${transformOrigin.y}px` }}>
					<SynchronizedHtmlSpin center={transformOrigin} spin={presentation.spin}><div ref={scaled} style={{ width: '100%', height: '100%', transformOrigin: `${scaleOrigin.x}px ${scaleOrigin.y}px` }}>{children}</div></SynchronizedHtmlSpin>
				</div>
			</SynchronizedHtmlMotion>
		</div>
	)
}
