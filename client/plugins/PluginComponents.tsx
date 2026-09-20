import { forwardRef, useEffect, type ReactNode } from 'react'
import { DefaultShapeWrapper, type Editor, type TLShapeWrapperProps } from 'tldraw'
import { useBasdrawPlugins } from './PluginContext'

export function PluginCanvasOverlays() {
	const { enabled } = useBasdrawPlugins()
	const overlays = enabled
		.flatMap((plugin) => plugin.canvasOverlays ?? [])
		.sort((a, b) => a.order - b.order)
	return <>{overlays.map(({ id, component: Overlay }) => <Overlay key={id} />)}</>
}

export const PluginShapeWrapper = forwardRef<HTMLDivElement, TLShapeWrapperProps>(function PluginShapeWrapper(
	{ children, shape, isBackground, ...props },
	ref,
) {
	const { enabled } = useBasdrawPlugins()
	const decorators = enabled
		.flatMap((plugin) => plugin.shapeDecorators ?? [])
		.sort((a, b) => a.order - b.order)
	let content = children
	for (const { id, component: Decorator } of [...decorators].reverse()) {
		content = <Decorator key={id} shape={shape}>{content}</Decorator>
	}
	return <DefaultShapeWrapper ref={ref} shape={shape} isBackground={isBackground} {...props}>{content}</DefaultShapeWrapper>
})

export function PluginProviders({ children }: { children: ReactNode }) {
	const { enabled } = useBasdrawPlugins()
	const providers = enabled
		.flatMap((plugin) => plugin.providers ?? [])
		.sort((a, b) => a.order - b.order)
	return providers.reduceRight<ReactNode>((content, { id, component: Provider }) => (
		<Provider key={id}>{content}</Provider>
	), children)
}

export function PluginAppPanels({ area }: { area: 'left' | 'right' }) {
	const { enabled } = useBasdrawPlugins()
	const panels = enabled
		.flatMap((plugin) => plugin.appPanels ?? [])
		.filter((panel) => panel.area === area)
		.sort((a, b) => a.order - b.order)
	return <>{panels.map(({ id, component: Panel }) => <Panel key={id} />)}</>
}

export function usePluginEditorMount(editor: Editor | null) {
	const { enabled } = useBasdrawPlugins()
	useEffect(() => {
		if (!editor) return
		const cleanups = enabled
			.map((plugin) => plugin.onEditorMount?.(editor))
			.filter((cleanup): cleanup is () => void => typeof cleanup === 'function')
		return () => { for (const cleanup of cleanups.reverse()) cleanup() }
	}, [editor, enabled])
}
