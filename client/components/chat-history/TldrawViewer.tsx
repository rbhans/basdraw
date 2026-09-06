import { useEffect, useRef, useState } from 'react'
import {
	defaultAddFontsFromNode,
	defaultBindingUtils,
	defaultEditorAssetUrls,
	defaultShapeUtils,
	Editor,
	StateNode,
	tipTapDefaultExtensions,
	TLComponents,
	TldrawEditor,
	TldrawUiContextProvider,
	TLShape,
} from 'tldraw'
import { BasRuntimeProvider } from '../../bas/BasRuntimeContext'
import { dataWidgetShapeUtils } from '../../bas/DataWidgetShapes'

const previewRuntime = {
	document: { version: 2 as const, stationAlias: null, bindings: [] },
	connected: false,
	stationAlias: null,
	historySeries: {},
	loadHistory: async () => {},
	snapshots: {},
}

export function TldrawViewer({
	shapes,
	components = {},
}: {
	shapes: TLShape[]
	components?: TLComponents
}) {
	const [editor, setEditor] = useState<Editor | null>(null)
	const [isVisible, setIsVisible] = useState(false)
	const containerRef = useRef<HTMLDivElement>(null)

	// Hide the component if it's outside of the current scroll area
	useEffect(() => {
		const observer = new IntersectionObserver(
			([entry]) => {
				setIsVisible(entry.isIntersecting)
			},
			{ rootMargin: '200px', threshold: 0 }
		)

		const currentElement = containerRef.current
		if (currentElement) observer.observe(currentElement)

		return () => {
			if (currentElement) observer.unobserve(currentElement)
		}
	}, [])

	useEffect(() => {
		if (!editor || !isVisible) return
		editor.updateInstanceState({ isReadonly: false })
		editor.setCameraOptions({ isLocked: false })
		editor.deleteShapes(editor.getCurrentPageShapes())
		editor.createShapes(shapes)
		editor.updateInstanceState({ isReadonly: true })
		editor.selectAll()
		const bounds = editor.getSelectionPageBounds()
		if (bounds) {
			editor.zoomToBounds(bounds, { inset: 30 })
		}
		editor.selectNone()
		editor.setCameraOptions({ isLocked: true })
	}, [shapes, editor, isVisible])

	if (!isVisible) {
		return <div ref={containerRef} className="tldraw-viewer" />
	}

	return (
		<div ref={containerRef} className="tldraw-viewer">
			<BasRuntimeProvider value={previewRuntime}>
				<TldrawUiContextProvider>
					<TldrawEditor
						autoFocus={false}
						components={components ?? {}}
						onMount={setEditor}
						shapeUtils={[...defaultShapeUtils, ...dataWidgetShapeUtils]}
						bindingUtils={defaultBindingUtils}
						tools={tools}
						options={defaultOptions}
						assetUrls={defaultEditorAssetUrls}
						initialState="inspect"
					/>
				</TldrawUiContextProvider>
			</BasRuntimeProvider>
		</div>
	)
}

class InspectTool extends StateNode {
	static override id = 'inspect'
}

const tools = [InspectTool]

const defaultOptions = {
	text: {
		tipTapConfig: {
			extensions: tipTapDefaultExtensions,
		},
		addFontsFromNode: defaultAddFontsFromNode,
	},
}
