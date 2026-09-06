import { forwardRef, type CSSProperties } from 'react'
import { DefaultShapeWrapper, type TLShapeWrapperProps, useEditor } from 'tldraw'
import { useBasRuntime } from './BasRuntimeContext'
import { bindingsForRenderedShape, pageVectorInShapeSpace, transformOriginForBindings } from './bindingScope'
import { getRuntimeShapePresentation } from './runtimeMapping'
import { SynchronizedHtmlMotion } from './SynchronizedMotion'
import { SynchronizedHtmlSpin } from './SynchronizedSpin'

export const RuntimeShapeWrapper = forwardRef(function RuntimeShapeWrapper(
	{ children, shape, isBackground, ...props }: TLShapeWrapperProps,
	ref: React.Ref<HTMLDivElement>,
) {
	const editor = useEditor()
	const { document, snapshots } = useBasRuntime()
	const bindings = bindingsForRenderedShape(editor, shape, document.bindings)
	const presentation = getRuntimeShapePresentation(bindings, snapshots)
	const geometry = editor.getShapeGeometry(shape)
	const transformOrigin = transformOriginForBindings(editor, shape, bindings, geometry.bounds.center)
	const scaleOrigin = transformOriginForBindings(editor, shape, bindings, geometry.bounds.center, 'scale')
	const translation = pageVectorInShapeSpace(editor, shape, presentation.translation)
	const motion = presentation.motion
		? { ...pageVectorInShapeSpace(editor, shape, presentation.motion), secondsPerCycle: presentation.motion.secondsPerCycle }
		: undefined
	const transforms: string[] = []
	if (translation.x !== 0 || translation.y !== 0) transforms.push(`translate(${translation.x}px, ${translation.y}px)`)
	if (presentation.rotation != null) transforms.push(`rotate(${presentation.rotation}deg)`)
	const presentationStyle: CSSProperties = {
		height: '100%',
		width: '100%',
		opacity: presentation.opacity,
		visibility: presentation.visible === false ? 'hidden' : undefined,
	}
	const transformStyle: CSSProperties = {
		height: '100%',
		width: '100%',
		transform: transforms.length ? transforms.join(' ') : undefined,
		transformOrigin: `${transformOrigin.x}px ${transformOrigin.y}px`,
	}

	return (
		<DefaultShapeWrapper ref={ref} shape={shape} isBackground={isBackground} {...props}>
			<div className="runtime-shape-content" style={presentationStyle}>
				<SynchronizedHtmlMotion motion={motion} motions={presentation.motions?.map((item) => ({ ...pageVectorInShapeSpace(editor, shape, item), secondsPerCycle: item.secondsPerCycle }))}>
					<div className="runtime-shape-transform" style={transformStyle}>
						<SynchronizedHtmlSpin center={transformOrigin} spin={presentation.spin}><div style={{ width: '100%', height: '100%', transform: presentation.scale != null ? `scale(${presentation.scale})` : undefined, transformOrigin: `${scaleOrigin.x}px ${scaleOrigin.y}px` }}>{children}</div></SynchronizedHtmlSpin>
					</div>
				</SynchronizedHtmlMotion>
			</div>
		</DefaultShapeWrapper>
	)
})
