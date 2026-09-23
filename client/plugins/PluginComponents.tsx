import { forwardRef, useEffect, useMemo, type ReactNode } from 'react'
import { DefaultShapeWrapper, type Editor, type TLShapeWrapperProps } from 'tldraw'
import { useBasdrawPlugins } from './PluginContext'
import { PluginBoundary } from './PluginBoundary'

export function PluginCanvasOverlays() {
	const { enabled } = useBasdrawPlugins()
	const overlays = enabled
		.flatMap((plugin) => (plugin.canvasOverlays ?? []).map((overlay) => ({ ...overlay, label: plugin.label })))
		.sort((a, b) => a.order - b.order)
	return <>{overlays.map(({ id, label, component: Overlay }) => <PluginBoundary key={id} label={label} contribution={id} fallback="silent"><Overlay /></PluginBoundary>)}</>
}

export const PluginShapeWrapper = forwardRef<HTMLDivElement, TLShapeWrapperProps>(function PluginShapeWrapper(
	{ children, shape, isBackground, ...props },
	ref,
) {
	const { enabled } = useBasdrawPlugins()
	const decorators = useMemo(() => enabled
		.flatMap((plugin) => (plugin.shapeDecorators ?? []).map((decorator) => ({ ...decorator, label: plugin.label })))
		.sort((a, b) => a.order - b.order), [enabled])
	let content = children
	// A failing decorator falls back to the undecorated shape; shape errors still reach tldraw's own boundary.
	for (const { id, label, component: Decorator } of [...decorators].reverse()) {
		content = <PluginBoundary key={id} label={label} contribution={id} fallback="passthrough" fallbackChildren={content}>
			<Decorator shape={shape}>{content}</Decorator>
		</PluginBoundary>
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
		.flatMap((plugin) => (plugin.appPanels ?? []).map((panel) => ({ ...panel, label: plugin.label })))
		.filter((panel) => panel.area === area)
		.sort((a, b) => a.order - b.order)
	return <>{panels.map(({ id, label, component: Panel }) => <PluginBoundary key={id} label={label} contribution={id} fallback="silent"><Panel /></PluginBoundary>)}</>
}

export function usePluginEditorMount(editor: Editor | null) {
	const { enabled } = useBasdrawPlugins()
	useEffect(() => {
		if (!editor) return
		const cleanups = enabled
			.map((plugin) => {
				try { return plugin.onEditorMount?.(editor) }
				catch (error) { console.error(`[basdraw] Plugin ${plugin.id} failed to mount.`, error); return undefined }
			})
			.filter((cleanup): cleanup is () => void => typeof cleanup === 'function')
		return () => { for (const cleanup of cleanups.reverse()) cleanup() }
	}, [editor, enabled])
}
