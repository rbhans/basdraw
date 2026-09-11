import { useEffect, useState } from 'react'
import { BaseBoxShapeUtil, HTMLContainer, T, resizeBox, useEditor, useValue, type RecordProps, type TLBaseShape, type TLResizeInfo } from 'tldraw'

export const WEB_VIEW_TYPE = 'bas-web-view' as const
export type WebViewShape = TLBaseShape<typeof WEB_VIEW_TYPE, { w: number; h: number; url: string; title: string; contentScale?: number }>
declare module '@tldraw/tlschema' {
	interface TLGlobalShapePropsMap { [WEB_VIEW_TYPE]: WebViewShape['props'] }
}

export function webViewUrl(input: string): string {
	const value = input.trim()
	if (!value) throw new Error('Enter a web address.')
	const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(value)
	const isHostWithPort = /^[^/:]+:\d+(\/|$)/.test(value)
	const url = new URL(hasScheme && !isHostWithPort ? value : `https://${value}`)
	if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use an HTTP or HTTPS address.')
	if (url.username || url.password) throw new Error('Sign in on the page instead of putting credentials in its address.')
	return url.href
}

export class WebViewShapeUtil extends BaseBoxShapeUtil<WebViewShape> {
	static override type = WEB_VIEW_TYPE
	static override props: RecordProps<WebViewShape> = {
		w: T.positiveNumber, h: T.positiveNumber, url: T.string, title: T.string,
		// Optional for drawings created before content scaling; omitted means 100%.
		contentScale: T.number.check(value => { if (value < 0.25 || value > 4) throw new Error('Content scale must be between 25% and 400%') }).optional(),
	}
	getDefaultProps(): WebViewShape['props'] { return { w: 960, h: 640, url: '', title: 'Web view' } }
	override canEdit() { return true }
	override isAspectRatioLocked() { return false }
	override onResize(shape: WebViewShape, info: TLResizeInfo<WebViewShape>) { return resizeBox(shape, info, { minWidth: 320, minHeight: 240 }) }
	override getText(shape: WebViewShape) { return `${shape.props.title} ${shape.props.url}` }
	component(shape: WebViewShape) { return <WebView shape={shape} /> }
	getIndicatorPath(shape: WebViewShape) { const path = new Path2D(); path.roundRect(0, 0, shape.props.w, shape.props.h, 8); return path }
	// Cross-origin page pixels cannot be included in a canvas SVG export.
	override toSvg(shape: WebViewShape) { return <g><rect width={shape.props.w} height={shape.props.h} rx={8} fill="#f9fafb" stroke="#9ca3af" /><text x={20} y={32} fontSize={18} fill="#111827">{shape.props.title || 'Web view'}</text><text x={20} y={60} fontSize={12} fill="#4b5563">{shape.props.url}</text></g> }
}

function WebView({ shape }: { shape: WebViewShape }) {
	const editor = useEditor()
	const editing = useValue('web view editing', () => editor.getEditingShapeId() === shape.id, [editor, shape.id])
	const selectTool = useValue('web view tool', () => editor.getCurrentToolId() === 'select', [editor])
	const interactive = editing && selectTool && !shape.isLocked
	const scale = shape.props.contentScale ?? 1
	const [reload, setReload] = useState(0)
	const [failed, setFailed] = useState(false)
	let url = ''
	try { if (shape.props.url) url = webViewUrl(shape.props.url) } catch { /* Invalid imported URLs never reach the iframe. */ }
	useEffect(() => { setFailed(false) }, [url, reload])
	useEffect(() => {
		if (editing && (!selectTool || shape.isLocked)) editor.setEditingShape(null)
	}, [editing, selectTool, shape.isLocked, editor])
	const finish = () => { editor.setEditingShape(null); editor.setCurrentTool('select'); editor.focus() }
	return <HTMLContainer className="bas-web-view" style={{ width: shape.props.w, height: shape.props.h }}>
		<div className="bas-web-view-bar" style={{ pointerEvents: interactive ? 'auto' : 'none' }} onPointerDown={interactive ? (event) => event.stopPropagation() : undefined} onWheel={interactive ? (event) => event.stopPropagation() : undefined}>
			<strong title={url}>{shape.props.title || 'Web view'}</strong>
			{interactive ? <><button onClick={() => setReload((value) => value + 1)}>Reload</button><button onClick={finish}>Back to canvas</button></> : <span>Double-click to interact · Laser and drawing work over the page</span>}
		</div>
		<div className="bas-web-view-viewport">
			{url && !failed ? <iframe key={`${url}:${reload}`} src={url} title={shape.props.title || 'Web view'} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerPolicy="no-referrer" tabIndex={interactive ? 0 : -1} inert={!interactive} onError={() => setFailed(true)} style={{ width: `${100 / scale}%`, height: `${100 / scale}%`, transform: `scale(${scale})`, transformOrigin: 'top left', pointerEvents: interactive ? 'auto' : 'none' }} /> : <div className="bas-web-view-empty">{failed ? 'This page could not load. Open it in a browser or edit its address.' : 'Select this Web View and enter its address in the properties panel.'}</div>}
		</div>
	</HTMLContainer>
}
