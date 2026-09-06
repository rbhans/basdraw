import { TldrawUiButton, TldrawUiButtonLabel, useEditor, useValue } from 'tldraw'
import { navigateToShape, shapeName, shapeNavigation } from './shapeIdentity'

// Like tldraw's link affordance, navigation is explicit and never steals a draw,
// drag, text edit or ordinary selection gesture from the canvas.
export function ShapeNavigationOverlay() {
	const editor = useEditor()
	const view = useValue('selected navigation link', () => {
		const shape = editor.getOnlySelectedShape()
		const navigation = shape && shapeNavigation(shape)
		const bounds = shape && editor.getShapePageBounds(shape)
		if (!shape || !navigation?.enabled || !bounds || editor.getEditingShapeId()) return null
		const target = editor.getShape(navigation.targetId)
		const position = editor.pageToViewport({ x: bounds.maxX, y: bounds.minY })
		return { navigation, targetName: target ? shapeName(target) : navigation.targetName, missing: !target, position }
	}, [editor])
	if (!view) return null
	return <div className="bas-shape-navigation" style={{ left: view.position.x, top: view.position.y }} onPointerDown={(event) => event.stopPropagation()}>
		<TldrawUiButton type="normal" disabled={view.missing} title={view.missing ? 'Destination missing. Edit Navigation to choose another shape.' : `Go to ${view.targetName}`} onClick={() => navigateToShape(editor, view.navigation)}><TldrawUiButtonLabel>{view.missing ? 'Missing destination' : `Go to ${view.targetName}`} ↗</TldrawUiButtonLabel></TldrawUiButton>
	</div>
}
