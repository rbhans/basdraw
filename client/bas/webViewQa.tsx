// Isolated fixture: no persistence key, user drawing, station or credentials.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Tldraw, createShapeId, getSnapshot, loadSnapshot, useEditor, useValue, type Editor } from 'tldraw'
import { WEB_VIEW_TYPE, WebViewShapeUtil, webViewUrl, type WebViewShape } from './WebViewShape'
import { WebViewSettings, useWebViewDialog } from './WebViewSettings'
import { DataToolbar } from './DataToolbar'
import '../index.css'

const id = createShapeId('web-view-test')
const shapeUtils = [WebViewShapeUtil]
function Panel() {
	const editor = useEditor(), open = useWebViewDialog()
	const shape = useValue('test selection', () => editor.getOnlySelectedShape(), [editor])
	return <div style={{ width: 220, background: 'var(--tl-color-panel)' }}><button onClick={open}>Add Web View</button>{shape?.type === WEB_VIEW_TYPE && <WebViewSettings shape={shape} />}</div>
}
const components = { StylePanel: Panel, Toolbar: DataToolbar }
const overrides = { translations: { en: { 'tool.bas-web-view': 'Web View', 'tool.bas-table': 'Equipment table', 'tool.bas-trend': 'Trend chart' } } }
function Fixture() {
	const [editor, setEditor] = useState<Editor | null>(null)
	const [result, setResult] = useState('Not run')
	const test = () => {
		if (!editor) return
		try {
			let count = 0
			const check = (value: unknown, message: string) => { if (!value) throw new Error(message); count++ }
			check(webViewUrl('example.com') === 'https://example.com/', 'default HTTPS')
			check(webViewUrl('localhost:5173/test') === 'https://localhost:5173/test', 'host and port')
			for (const url of ['javascript:alert(1)', 'data:text/html,test', 'file:///etc/passwd', 'https://user:password@example.com']) {
				let rejected = false; try { webViewUrl(url) } catch { rejected = true }; check(rejected, `reject ${url}`)
			}
			const original = editor.getShape<WebViewShape>(id)!
			check((original.props.contentScale ?? 1) === 1, 'legacy default scale')
			editor.markHistoryStoppingPoint('test scale'); editor.updateShape<WebViewShape>({ id, type: WEB_VIEW_TYPE, props: { contentScale: 2 } })
			check(editor.getShape<WebViewShape>(id)!.props.w === original.props.w && editor.getShape<WebViewShape>(id)!.props.h === original.props.h, 'scale leaves frame unchanged')
			editor.undo(); check((editor.getShape<WebViewShape>(id)!.props.contentScale ?? 1) === 1, 'undo scale')
			editor.redo(); check(editor.getShape<WebViewShape>(id)!.props.contentScale === 2, 'redo scale')
			for (const value of [0, 5]) {
				let rejected = false; try { WebViewShapeUtil.props.contentScale!.validate(value) } catch { rejected = true }; check(rejected, 'reject out-of-range scale')
			}
			editor.markHistoryStoppingPoint('test resize'); editor.resizeShape(id, { x: 1.2, y: 0.8 })
			check(editor.getShape<WebViewShape>(id)!.props.w !== original.props.w, 'resize width')
			check(editor.getShape<WebViewShape>(id)!.props.h !== original.props.h, 'resize height')
			check(editor.getShape<WebViewShape>(id)!.props.contentScale === 2, 'resize retains scale')
			editor.undo(); check(editor.getShape<WebViewShape>(id)!.props.w === original.props.w, 'undo resize')
			editor.markHistoryStoppingPoint('test edit'); editor.updateShape<WebViewShape>({ id, type: WEB_VIEW_TYPE, props: { title: 'Updated page', url: `${location.origin}/scripts/web-view-content.html?changed` } })
			editor.undo(); check(editor.getShape<WebViewShape>(id)!.props.url === original.props.url, 'undo URL')
			editor.redo(); check(editor.getShape<WebViewShape>(id)!.props.title === 'Updated page', 'redo title')
			const snapshot = getSnapshot(editor.store); loadSnapshot(editor.store, snapshot)
			check(editor.getShape<WebViewShape>(id)!.props.title === 'Updated page', 'snapshot retains page')
			check(editor.getShape<WebViewShape>(id)!.props.contentScale === 2, 'snapshot retains scale')
			editor.markHistoryStoppingPoint('duplicate web view'); editor.duplicateShapes([id])
			check(editor.getCurrentPageShapes().filter(s => s.type === WEB_VIEW_TYPE).length === 2, 'duplicate')
			check(editor.getCurrentPageShapes().filter(s => s.type === WEB_VIEW_TYPE).every(s => s.props.contentScale === 2), 'duplicate retains scale')
			editor.undo(); editor.select(id)
			setResult(`${count} checks passed`)
		} catch (error) { setResult(`FAIL: ${String(error)}`) }
	}
	return <><div style={{ height: 44, padding: 8 }}>Isolated Web View QA <button onClick={test}>Run checks</button><button onClick={() => { editor?.setCurrentTool('laser'); editor?.focus() }}>Laser</button><button onClick={() => { editor?.setCurrentTool('draw'); editor?.focus() }}>Draw</button><button onClick={() => { editor?.setCurrentTool('select'); editor?.select(id); editor?.focus() }}>Select Web View</button><span role="status">{result}</span></div><div style={{ position: 'absolute', inset: '44px 0 0' }}><Tldraw shapeUtils={shapeUtils} components={components} overrides={overrides} onMount={mounted => {
		mounted.createShape<WebViewShape>({ id, type: WEB_VIEW_TYPE, x: 80, y: 90, props: { w: 740, h: 500, title: 'Equipment', url: `${location.origin}/scripts/web-view-content.html` } })
		mounted.select(id); setEditor(mounted)
	}} /></div></>
}
if (import.meta.env.DEV) { const root = createRoot(document.getElementById('root')!); root.render(<Fixture />); import.meta.hot?.dispose(() => root.unmount()) }
