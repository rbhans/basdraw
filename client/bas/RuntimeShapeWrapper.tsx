import { forwardRef, useRef, type ReactNode } from 'react'
import { DefaultShapeWrapper, type TLShapeWrapperProps, type TLShape, useEditor } from 'tldraw'
import type { ShapeBinding, PointSnapshot } from './types'
import { useBasRuntime } from './BasRuntimeContext'
import { bindingsForRenderedShape, pageVectorInShapeSpace, transformOriginForBindings } from './bindingScope'
import { getRuntimeShapePresentation } from './runtimeMapping'
import { SynchronizedHtmlMotion, SynchronizedHtmlSpin } from './RuntimeMotion'
import { useRuntimeValues } from './runtimeAnimationHooks'

export const RuntimeShapeWrapper = forwardRef(function RuntimeShapeWrapper(
	{ children, shape, isBackground, ...props }: TLShapeWrapperProps,
	ref: React.Ref<HTMLDivElement>,
) {
	const editor = useEditor()
	const { document, snapshots } = useBasRuntime()
	const bindings = bindingsForRenderedShape(editor, shape, document.bindings)
	return <DefaultShapeWrapper ref={ref} shape={shape} isBackground={isBackground} {...props}>
		{bindings.length ? <RuntimeShapeContent shape={shape} bindings={bindings} snapshots={snapshots}>{children}</RuntimeShapeContent> : children}
	</DefaultShapeWrapper>
})

export function RuntimeShapeDecorator({ shape, children }: { shape: TLShape; children: ReactNode }) {
	const editor = useEditor()
	const { document, snapshots } = useBasRuntime()
	const bindings = bindingsForRenderedShape(editor, shape, document.bindings)
	return bindings.length
		? <RuntimeShapeContent shape={shape} bindings={bindings} snapshots={snapshots}>{children}</RuntimeShapeContent>
		: children
}

function RuntimeShapeContent({ shape, bindings, snapshots, children }: { shape: TLShape; bindings: ShapeBinding[]; snapshots: Record<string, PointSnapshot>; children: ReactNode }) {
	const editor = useEditor()
	const presentation = getRuntimeShapePresentation(bindings, snapshots)
	const geometry = editor.getShapeGeometry(shape)
	const transformOrigin = transformOriginForBindings(editor, shape, bindings, geometry.bounds.center)
	const scaleOrigin = transformOriginForBindings(editor, shape, bindings, geometry.bounds.center, 'scale')
	const motion = presentation.motion
		? { ...presentation.motion, ...pageVectorInShapeSpace(editor, shape, presentation.motion) }
		: undefined
	const content = useRef<HTMLDivElement>(null), transform = useRef<HTMLDivElement>(null), scaled = useRef<HTMLDivElement>(null)
	useRuntimeValues({ x: presentation.translation?.x ?? 0, y: presentation.translation?.y ?? 0, rotation: presentation.rotation ?? 0, scale: presentation.scale ?? 1, opacity: presentation.opacity ?? 1 }, values => {
		const translation = pageVectorInShapeSpace(editor, shape, { x: values.x, y: values.y })
		if (content.current) content.current.style.opacity = String(values.opacity)
		if (transform.current) transform.current.style.transform = `translate(${translation.x}px, ${translation.y}px) rotate(${values.rotation}deg)`
		if (scaled.current) scaled.current.style.transform = `scale(${values.scale})`
	})

	return (
			<div ref={content} className="runtime-shape-content" style={{ visibility: presentation.visible === false ? 'hidden' : undefined }}>
				<SynchronizedHtmlMotion motion={motion} motions={presentation.motions?.map((item) => ({ ...item, ...pageVectorInShapeSpace(editor, shape, item) }))}>
					<div ref={transform} className="runtime-shape-transform" style={{ transformOrigin: `${transformOrigin.x}px ${transformOrigin.y}px` }}>
						<SynchronizedHtmlSpin center={transformOrigin} spin={presentation.spin}><div ref={scaled} style={{ width: '100%', height: '100%', transformOrigin: `${scaleOrigin.x}px ${scaleOrigin.y}px` }}>{children}</div></SynchronizedHtmlSpin>
					</div>
				</SynchronizedHtmlMotion>
			</div>
	)
}
