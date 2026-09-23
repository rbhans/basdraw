import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type ReactNode } from 'react'
import { useEditor } from 'tldraw'
import { useWorkspace } from './BasWorkspaceContext'
import type { PointSnapshot, StationNode } from './types'

const MIME = 'application/x-basdraw-point'
export type DraggedPoint = { point: StationNode; stationAlias: string; snapshot?: PointSnapshot }
type PointDrop = DraggedPoint & { shapeId: string; token: number }
type DragContext = { dragged: DraggedPoint | null; begin: (event: ReactDragEvent, point: StationNode) => void; end: () => void; pending: PointDrop | null; request: (drop: PointDrop | null) => void; available: boolean }
const Context = createContext<DragContext | null>(null)

export function PointDragProvider({ children }: { children: ReactNode }) {
	const workspace = useWorkspace()
	const alias = workspace.connectedProfile?.alias
	const [dragged, setDragged] = useState<DraggedPoint | null>(null)
	const [pending, request] = useState<PointDrop | null>(null)
	const end = useCallback(() => setDragged(null), [])
	const begin = useCallback((event: ReactDragEvent, point: StationNode) => {
		if (!alias) { event.preventDefault(); return }
		// Only in-app drags are accepted; no external payload is trusted as a point.
		event.dataTransfer.setData(MIME, 'point')
		event.dataTransfer.effectAllowed = 'copy'
		setDragged({ point, stationAlias: alias })
	}, [alias])
	const value = useMemo<DragContext>(() => ({ dragged, pending, request, end, begin, available: true }), [begin, dragged, end, pending])
	return <Context.Provider value={value}>{children}</Context.Provider>
}

// Drag-to-bind belongs to the baskStream plugin. Without it, consumers get an inert
// context: nothing is ever dragged or pending, and begin/request are no-ops.
const INERT_DRAG: DragContext = {
	dragged: null,
	pending: null,
	available: false,
	begin: (event) => { event.preventDefault() },
	end: () => {},
	request: () => {},
}

/** Optional context: safe to call when the baskStream plugin (its provider) is disabled. */
export function usePointDrag(): DragContext {
	return useContext(Context) ?? INERT_DRAG
}

export function CanvasPointDrop() {
	const editor = useEditor()
	const workspace = useWorkspace()
	const drag = usePointDrag()
	const [message, setMessage] = useState('')
	const sequence = useRef(0)
	useEffect(() => () => { sequence.current++ }, [])
	useEffect(() => {
		if (!drag.dragged) return
		const source = drag.dragged
		const container = editor.getContainer()
		const isCanvas = (event: DragEvent) => event.target instanceof Element && !event.target.closest('.tlui-layout, .tlui-dialog__content')
		const over = (event: DragEvent) => {
			if (!isCanvas(event)) return
			event.preventDefault(); event.stopPropagation()
			if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
		}
		const drop = async (event: DragEvent) => {
			if (!isCanvas(event)) return
			event.preventDefault(); event.stopImmediatePropagation()
			const token = ++sequence.current
			drag.end()
			if (source.stationAlias !== workspace.connectedProfile?.alias || editor.getIsReadonly()) return
			const hit = editor.getShapeAtPoint(editor.screenToPage({ x: event.clientX, y: event.clientY }), { hitInside: true, margin: 6 / editor.getZoomLevel() })
			const shape = hit && editor.getOutermostSelectableShape(hit)
			if (!shape || shape.isLocked) { setMessage('Drop onto an unlocked shape. Use Change point to replace an existing driver.'); return }
			setMessage('Reading dropped point…')
			try {
				const snapshot = await workspace.readPoint(source.point)
				if (!snapshot || snapshot.ok === false) throw new Error('This point could not be read.')
				if (sequence.current !== token || !editor.getShape(shape.id) || editor.getShape(shape.id)?.isLocked || editor.getIsReadonly()) return
				editor.select(shape.id)
				drag.request({ ...source, snapshot, shapeId: shape.id, token })
				setMessage('')
			} catch (cause) { if (sequence.current === token) setMessage(String(cause)) }
		}
		container.addEventListener('dragover', over, true)
		container.addEventListener('drop', drop, true)
		return () => { container.removeEventListener('dragover', over, true); container.removeEventListener('drop', drop, true) }
	}, [drag, editor, workspace.connectedProfile?.alias, workspace.readPoint])
	return drag.dragged || message ? <div className="canvas-point-drop-hint" role="status">{drag.dragged ? 'Drop onto a shape to choose a behavior · use saved geometry when effects are paused' : message}{!drag.dragged && <button aria-label="Dismiss point drop message" onClick={() => setMessage('')}>×</button>}</div> : null
}
