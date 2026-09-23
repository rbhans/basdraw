import { useEffect } from 'react'
import { BaseBoxShapeUtil, HTMLContainer, T, resizeBox, useEditor, useValue, useToasts, useDialogs, useTranslation, TldrawUiButton, TldrawUiButtonLabel, TldrawUiDialogHeader, TldrawUiDialogTitle, TldrawUiDialogCloseButton, TldrawUiDialogBody, type TLBaseShape, type TLResizeInfo, type TLShape, type TLAssetId } from 'tldraw'
import { useOptionalBasdrawPlugins } from '../plugins/PluginContext'
import { DOCUMENT_TYPE, documentAccept, importDocument, readCanvasDocument, retryDocument, documentFile, installDocumentRuntime, documentIndexState, confirmDocumentIndexing } from './documentRuntime'

export type DocumentShape = TLBaseShape<'bas-document', { w: number; h: number; title: string; assetId: TLAssetId }>
declare module '@tldraw/tlschema' { interface TLGlobalShapePropsMap { 'bas-document': DocumentShape['props'] } }
export class DocumentShapeUtil extends BaseBoxShapeUtil<DocumentShape> {
 static override type = DOCUMENT_TYPE
 static override props = { w: T.positiveNumber, h: T.positiveNumber, title: T.string, assetId: T.string }
 getDefaultProps(): DocumentShape['props'] { return { w: 480, h: 600, title: 'Document', assetId: '' as TLAssetId } }
 override onResize(shape: DocumentShape, info: TLResizeInfo<DocumentShape>) { return resizeBox(shape, info, { minWidth: 200, minHeight: 200 }) }
 override getText(shape: DocumentShape) { return shape.props.title }
 component(shape: DocumentShape) { return <DocumentCard shape={shape} /> }
 getIndicatorPath(shape: DocumentShape) { const path = new Path2D(); path.rect(0, 0, shape.props.w, shape.props.h); return path }
 override toSvg(shape: DocumentShape) {
  const asset = this.editor.getAsset(shape.props.assetId), doc = asset && readCanvasDocument(asset.meta)
  return <g><rect width={shape.props.w} height={shape.props.h} fill="white" stroke="#888"/>{doc?.extraction?.preview ? <image href={doc.extraction.preview} x={8} y={40} width={shape.props.w - 16} height={shape.props.h - 48}/> : <text x={16} y={64} fill="#333" fontSize={12}>{doc?.extraction?.sections.slice(0, 3).map(s => s.text).join(' ').slice(0, 140)}</text>}<text x={16} y={24} fontSize={16} fill="#111">{shape.props.title}</text></g>
 }
}

function DocumentCard({ shape }: { shape: DocumentShape }) {
 const editor = useEditor()
 const asset = useValue('document asset', () => editor.getAsset(shape.props.assetId), [editor, shape.props.assetId])
 const doc = asset && readCanvasDocument(asset.meta)
 const awaiting = useValue('document index state', () => documentIndexState(editor, shape.props.assetId) === 'awaiting-confirmation', [editor, shape.props.assetId])
 return <HTMLContainer className="bas-document" style={{ width: shape.props.w, height: shape.props.h }}>
  <header><strong>{shape.props.title}</strong><span>{awaiting ? 'Not indexed' : doc?.status === 'ready' ? 'Ready for AI' : doc?.status === 'error' ? 'Needs attention' : 'Reading…'}</span></header>
  {doc?.extraction?.preview ? <img src={doc.extraction.preview} draggable={false} alt="Document preview"/> : <pre>{doc?.extraction?.sections.map(s => s.text).join('\n').slice(0, 6000) || 'Reading document text and tables…'}</pre>}
 </HTMLContainer>
}

export function documentAssetId(shape: TLShape) {
 return (shape.meta.basDocumentAssetId || ('assetId' in shape.props ? shape.props.assetId : undefined)) as TLAssetId | undefined
}

export function DocumentProperties({ shape }: { shape: TLShape }) {
 const editor = useEditor(), { addDialog } = useDialogs(), { addToast } = useToasts()
 const vectorPdfEnabled = useOptionalBasdrawPlugins()?.isEnabled('vector-pdf') ?? true
 const id = documentAssetId(shape)
 const asset = useValue('document properties asset', () => id ? editor.getAsset(id) : undefined, [editor, id])
 const doc = asset && readCanvasDocument(asset.meta)
 const awaiting = useValue('document properties index state', () => id ? documentIndexState(editor, id) === 'awaiting-confirmation' : false, [editor, id])
 if (!doc || !id) return null
 return <section className="bas-document-properties">
  <strong>{doc.name}</strong><p role="status">{awaiting ? 'From an opened or pasted file. Not indexed for AI until you confirm.' : doc.status === 'ready' ? 'Ready for AI' : doc.status === 'error' ? doc.error : 'Reading document…'}</p>
  {awaiting && <TldrawUiButton type="primary" disabled={editor.getIsReadonly()} onClick={() => confirmDocumentIndexing(editor, [id])}><TldrawUiButtonLabel>Index for AI</TldrawUiButtonLabel></TldrawUiButton>}
  <TldrawUiButton type="normal" disabled={!doc.extraction} onClick={() => addDialog({ id: 'document-text', component: () => <div className="bas-document-dialog"><TldrawUiDialogHeader><TldrawUiDialogTitle>{doc.name}</TldrawUiDialogTitle><TldrawUiDialogCloseButton/></TldrawUiDialogHeader><TldrawUiDialogBody>{doc.extraction?.warnings.map((warning, i) => <p key={i}>{warning}</p>)}<pre>{doc.extraction?.sections.map(s => `[${s.location}${s.method === 'ocr' ? ` · OCR ${Math.round(s.confidence ?? 0)}%` : ''}]\n${s.text}`).join('\n\n')}</pre></TldrawUiDialogBody></div> })}><TldrawUiButtonLabel>View extracted text</TldrawUiButtonLabel></TldrawUiButton>
  <TldrawUiButton type="normal" onClick={async () => { const file = await documentFile(doc); const url = URL.createObjectURL(file); const a = document.createElement('a'); a.href = url; a.download = doc.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }}><TldrawUiButtonLabel>Download original</TldrawUiButtonLabel></TldrawUiButton>
  {doc.status === 'error' && <TldrawUiButton type="normal" disabled={editor.getIsReadonly()} onClick={() => retryDocument(editor, id)}><TldrawUiButtonLabel>Retry</TldrawUiButtonLabel></TldrawUiButton>}
  {vectorPdfEnabled && /\.pdf$/i.test(doc.name) && <TldrawUiButton type="normal" disabled={editor.getIsReadonly()} onClick={async () => { try { const file = await documentFile(doc); const { VectorPdfDialog } = await import('../bas/VectorPdfDialog'); addDialog({ id: 'bas-import-pdf', component: props => <VectorPdfDialog {...props} initialFile={file}/> }) } catch (error) { addToast({ title: 'Could not open document', description: String(error), severity: 'error' }) } }}><TldrawUiButtonLabel>Import editable page</TldrawUiButtonLabel></TldrawUiButton>}
 </section>
}

export function useImportDocument() {
 const editor = useEditor(), { addToast } = useToasts()
 return () => {
  const input = document.createElement('input'); input.type = 'file'; input.multiple = true; input.accept = documentAccept
  input.onchange = async () => {
   for (const file of Array.from(input.files ?? [])) {
    try {
     if (/\.(png|jpe?g|webp|gif|svg|bmp)$/i.test(file.name)) await editor.putExternalContent({ type: 'files', files: [file], point: editor.getViewportPageBounds().center, ignoreParent: false })
     else await importDocument(editor, file)
    } catch (error) { addToast({ title: 'Document import failed', description: String(error), severity: 'error' }) }
   }
  }
  input.click()
 }
}

export function DocumentNotifications() {
 const toasts = useToasts(), msg = useTranslation(), editor = useEditor()
 const { addToast } = toasts
 useEffect(() => installDocumentRuntime(editor, { toasts, msg }), [editor, toasts, msg])
 useEffect(() => { const report = (event: Event) => addToast({ title: 'Document import failed', description: (event as CustomEvent<string>).detail, severity: 'error' }); window.addEventListener('basdraw-document-error', report); return () => window.removeEventListener('basdraw-document-error', report) }, [addToast])
 return null
}
