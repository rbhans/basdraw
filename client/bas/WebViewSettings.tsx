import { useEffect, useState } from 'react'
import { createShapeId, TldrawUiButton, TldrawUiButtonLabel, TldrawUiInput, TldrawUiDialogHeader, TldrawUiDialogTitle, TldrawUiDialogCloseButton, TldrawUiDialogBody, TldrawUiDialogFooter, useDialogs, useEditor, useValue, type TLUiDialogProps } from 'tldraw'
import { WEB_VIEW_TYPE, webViewUrl, type WebViewShape } from './WebViewShape'
import { DataWidgetScaleControl } from './DataWidgetScaleControl'

export function useWebViewDialog() {
	const { addDialog } = useDialogs()
	return () => { addDialog({ id: 'bas-web-view', component: WebViewDialog }) }
}

function WebViewDialog({ onClose }: TLUiDialogProps) {
	const editor = useEditor()
	const [url, setUrl] = useState('')
	const [title, setTitle] = useState('Web view')
	const [error, setError] = useState('')
	const save = () => {
		try {
			const address = webViewUrl(url)
			if (editor.getIsReadonly()) return
			const center = editor.getViewportPageBounds().center, id = createShapeId()
			editor.markHistoryStoppingPoint('add web view')
			editor.setCurrentTool('select')
			editor.createShape<WebViewShape>({ id, type: WEB_VIEW_TYPE, x: center.x - 480, y: center.y - 320, props: { url: address, title: title.trim() || 'Web view' } })
			editor.select(id); onClose(); editor.focus()
		} catch (cause) { setError(cause instanceof Error ? cause.message : 'Enter a valid web address.') }
	}
	return <div className="data-setup-dialog">
		<TldrawUiDialogHeader><TldrawUiDialogTitle>New Web View</TldrawUiDialogTitle><TldrawUiDialogCloseButton /></TldrawUiDialogHeader>
		<TldrawUiDialogBody><label>Title<TldrawUiInput value={title} onValueChange={setTitle} aria-label="Web view title" /></label><label>Web address<TldrawUiInput value={url} onValueChange={setUrl} aria-label="Web address" placeholder="https://station/…" onComplete={save} /></label><p>Double-click to use the page. Select the laser or a drawing tool to mark over it.</p><p>Some sites block embedding. Niagara pages may require a separate browser login.</p>{error && <p role="alert">{error}</p>}</TldrawUiDialogBody>
		<TldrawUiDialogFooter><TldrawUiButton type="normal" onClick={onClose}><TldrawUiButtonLabel>Cancel</TldrawUiButtonLabel></TldrawUiButton><TldrawUiButton type="primary" disabled={!url.trim()} onClick={save}><TldrawUiButtonLabel>Add Web View</TldrawUiButtonLabel></TldrawUiButton></TldrawUiDialogFooter>
	</div>
}

export function WebViewSettings({ shape }: { shape: WebViewShape }) {
	const editor = useEditor()
	const editing = useValue('web settings editing', () => editor.getEditingShapeId() === shape.id, [editor, shape.id])
	const readonly = useValue('web settings readonly', () => editor.getIsReadonly(), [editor])
	const [url, setUrl] = useState(shape.props.url)
	const [title, setTitle] = useState(shape.props.title)
	const [error, setError] = useState('')
	useEffect(() => { setUrl(shape.props.url); setTitle(shape.props.title); setError('') }, [shape.props.url, shape.props.title])
	const locked = readonly || shape.isLocked
	const dirty = url !== shape.props.url || title !== shape.props.title
	const save = () => {
		if (locked) return
		try {
			const address = webViewUrl(url)
			editor.markHistoryStoppingPoint('edit web view')
			editor.updateShape<WebViewShape>({ id: shape.id, type: WEB_VIEW_TYPE, props: { url: address, title: title.trim() || 'Web view' } })
			setUrl(address); setError('')
		} catch (cause) { setError(cause instanceof Error ? cause.message : 'Enter a valid web address.') }
	}
	return <section className="bas-native-settings" aria-label="Web View settings">
		<strong>Web View</strong>
		<DataWidgetScaleControl key={`${shape.id}:${shape.props.contentScale ?? 1}`} shapeId={shape.id} scale={shape.props.contentScale} />
		<TldrawUiInput aria-label="Web view title" value={title} onValueChange={setTitle} disabled={locked} />
		<TldrawUiInput aria-label="Web address" value={url} onValueChange={setUrl} disabled={locked} onComplete={save} />
		{dirty && <><TldrawUiButton type="primary" disabled={locked} onClick={save}><TldrawUiButtonLabel>Save changes</TldrawUiButtonLabel></TldrawUiButton><TldrawUiButton type="normal" onClick={() => { setUrl(shape.props.url); setTitle(shape.props.title); setError('') }}><TldrawUiButtonLabel>Cancel</TldrawUiButtonLabel></TldrawUiButton></>}
		{error && <small role="alert">{error}</small>}
		<TldrawUiButton type="normal" disabled={locked} onClick={() => { editor.setCurrentTool('select'); editor.setEditingShape(editing ? null : shape.id); editor.focus() }}><TldrawUiButtonLabel>{editing ? 'Back to canvas' : 'Interact with page'}</TldrawUiButtonLabel></TldrawUiButton>
		<TldrawUiButton type="normal" onClick={() => { try { window.open(webViewUrl(shape.props.url), '_blank', 'noopener,noreferrer') } catch { setError('Enter a valid web address.') } }}><TldrawUiButtonLabel>Open in browser</TldrawUiButtonLabel></TldrawUiButton>
		<small>Laser and drawing tools work over the page. If it is blank or refuses to load, open it in a browser. Station login and embedding permissions apply separately from baskStream.</small>
	</section>
}
