import { useEffect, useRef, useState } from 'react'
import { TldrawUiButton, TldrawUiButtonLabel, TldrawUiDialogHeader, TldrawUiDialogTitle, TldrawUiDialogCloseButton, TldrawUiDialogBody, TldrawUiDialogFooter, useDialogs, useEditor, type TLUiDialogProps } from 'tldraw'
import { insertVectorPage, splitVectorPage, svgDataUrl, type VectorPage } from './vectorPdfImport'

export function useVectorPdfDialog() {
	const { addDialog } = useDialogs()
	return () => { addDialog({ id: 'bas-import-pdf', component: VectorPdfDialog }) }
}

export function VectorPdfDialog({ onClose, initialFile }: TLUiDialogProps & { initialFile?: File }) {
	const editor = useEditor()
	const [file, setFile] = useState<File | null>(initialFile || null)
	const [pageNumber, setPageNumber] = useState(1)
	const [pageCount, setPageCount] = useState<number | null>(null)
	const [preview, setPreview] = useState<VectorPage | null>(null)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState('')
	const request = useRef<AbortController | null>(null)
	useEffect(() => () => request.current?.abort(), [])
	const prepare = async () => {
		if (!file || busy) return
		setError(''); setPreview(null)
		if (file.size > 25 * 1024 * 1024) { setError('PDF files must be 25 MB or smaller.'); return }
		const controller = new AbortController(); request.current = controller; setBusy(true)
		try {
			let response: Response
			try {
				response = await fetch(`http://127.0.0.1:8790/pdf?page=${pageNumber}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-Basdraw-Import': '1' }, body: file, signal: controller.signal })
			} catch (cause) {
				if (controller.signal.aborted) return
				throw new Error('Local PDF import service unavailable. Start with npm run dev, or run npm run import:pdf separately.')
			}
			const result = await response.json() as { error?: string; pages: number; svg: string }
			if (response.ok && (!Number.isInteger(result.pages) || typeof result.svg !== 'string')) throw new Error('Invalid PDF conversion response.')
			if (!response.ok) throw new Error(result.error || 'PDF conversion failed.')
			if (controller.signal.aborted) return
			setPageCount(result.pages); setPreview(splitVectorPage(result.svg))
		} catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'PDF import failed.') }
		finally { if (!controller.signal.aborted) setBusy(false) }
	}
	const insert = () => {
		if (!preview || !file || busy) return
		try { insertVectorPage(editor, preview, `${file.name.replace(/\.pdf$/i, '')} · p${pageNumber}`); onClose(); editor.focus() }
		catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not import page.') }
	}
	return <div className="data-setup-dialog bas-pdf-dialog">
		<TldrawUiDialogHeader><TldrawUiDialogTitle>Import vector PDF</TldrawUiDialogTitle><TldrawUiDialogCloseButton /></TldrawUiDialogHeader>
		<TldrawUiDialogBody>
			<p>Import a control drawing as selectable vector pieces. Select related parts and use Group, then add Niagara behaviors to the group.</p>
			<label>PDF file<input aria-label="PDF file" type="file" accept="application/pdf,.pdf" disabled={busy} onChange={event => { setFile(event.target.files?.[0] || null); setPageNumber(1); setPageCount(null); setPreview(null); setError('') }} /></label>
			{file && <small>{file.name}</small>}
			<label>Page{pageCount ? ` (of ${pageCount})` : ''}<input aria-label="PDF page" type="number" min={1} max={pageCount || undefined} value={pageNumber} disabled={busy} onChange={event => { setPageNumber(Number(event.target.value)); setPreview(null); setError('') }} /></label>
			<TldrawUiButton type="normal" disabled={!file || busy || !Number.isInteger(pageNumber) || pageNumber < 1} onClick={prepare}><TldrawUiButtonLabel>{busy ? 'Preparing vectors…' : 'Preview page'}</TldrawUiButtonLabel></TldrawUiButton>
			{preview && <><img className="bas-pdf-preview" alt="Vector PDF page preview" src={svgDataUrl(preview.preview)} /><p>{preview.pieces.length.toLocaleString()} selectable pieces · {Math.round(preview.width)} × {Math.round(preview.height)} canvas units</p>{preview.rasterPieces > 0 && <p role="status">Includes {preview.rasterPieces} embedded image regions. Those remain images, not editable vector parts.</p>}<small>Text outlines stay together in runs where possible. Compound paths stay together; this is not a path-node editor. The white paper is locked inside the page frame.</small></>}
			{error && <p role="alert">{error}</p>}
			<small>Local conversion only. Requires Poppler on this computer. Import one page at a time, up to 25 MB / 3,000 pieces. Scanned pages are not supported.</small>
		</TldrawUiDialogBody>
		<TldrawUiDialogFooter><TldrawUiButton type="normal" onClick={onClose}><TldrawUiButtonLabel>Cancel</TldrawUiButtonLabel></TldrawUiButton><TldrawUiButton type="primary" disabled={!preview || busy} onClick={insert}><TldrawUiButtonLabel>Import page</TldrawUiButtonLabel></TldrawUiButton></TldrawUiDialogFooter>
	</div>
}
