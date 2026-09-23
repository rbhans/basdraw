import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Tldraw, useEditor, useValue, getSnapshot, loadSnapshot, serializeTldrawJson, TldrawUiButton, TldrawUiButtonLabel, DefaultStylePanel } from 'tldraw'
import 'tldraw/tldraw.css'
import '../index.css'
import { DocumentShapeUtil, DocumentNotifications, DocumentProperties, useImportDocument } from './DocumentShape'
import { importDocument, readCanvasDocument } from './documentRuntime'
import { getProjectId } from '../knowledge/currentKnowledgeScope'
import { insertVectorPage, splitVectorPage } from '../bas/vectorPdfImport'
// @ts-expect-error Shared deterministic JS fixture.
import { samplePdf } from '../../scripts/pdf-fixture.mjs'

const shapeUtils = [DocumentShapeUtil]
function Controls() {
 const editor = useEditor(), [status, setStatus] = useState('Ready'), [busy, setBusy] = useState(false)
 const choose = useImportDocument()
 const selected = useValue('qa selection', () => editor.getOnlySelectedShape(), [editor])
 async function waitForDocument(id: Parameters<typeof editor.getAsset>[0]) {
  const start = Date.now()
  while (Date.now() - start < 30000) {
   const doc = readCanvasDocument(editor.getAsset(id)?.meta ?? {})
   if (doc?.status === 'error') throw new Error(doc.error)
   if (doc?.status === 'ready') return doc
   await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Document processing timed out.')
 }
 async function mediaChecks() {
  setBusy(true); setStatus('Checking image and editable PDF sources…')
  try {
   const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="300"><rect width="800" height="300" fill="white"/><text x="30" y="100" font-family="Arial" font-size="48">VAV-1 Room 101</text><rect x="30" y="170" width="80" height="30" fill="blue"><animate attributeName="x" values="30;200;30" dur="2s" repeatCount="indefinite"/></rect></svg>'
   await editor.putExternalContent({ type: 'files', files: [new File([svg], 'animated-schedule.svg', { type: 'image/svg+xml' })], ignoreParent: false, point: { x: 1000, y: 200 } })
   const imageShape = editor.getOnlySelectedShape()
   if (imageShape?.type !== 'image' || !imageShape.props.assetId) throw new Error('Image import did not create a native image.')
   const doc = await waitForDocument(imageShape.props.assetId)
   const src = editor.getAsset(imageShape.props.assetId)
   if (src?.type !== 'image' || !(await (await fetch(src.props.src!)).text()).includes('<animate')) throw new Error('Animated SVG was flattened.')
   if (!doc.extraction?.sections.some(s => s.text.includes('101'))) throw new Error('Image OCR missed fixture text.')
   const pdf = new File([samplePdf()], 'Editable drawing.pdf', { type: 'application/pdf' })
   const response = await fetch('http://127.0.0.1:8790/pdf?page=1', { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-Basdraw-Import': '1' }, body: pdf })
   const result = await response.json() as { svg: string }
   const frame = insertVectorPage(editor, splitVectorPage(result.svg), 'Editable drawing').frame
   const asset = await importDocument(editor, pdf, undefined, frame)
   const source = await waitForDocument(asset)
   const saved = await serializeTldrawJson(editor)
   if (!saved.includes(source.source) || !saved.includes('AHU-01 CONTROL DRAWING')) throw new Error('Editable PDF source/extraction lost on save.')
   setStatus('PASS: native animated SVG preserved, image OCR indexed, editable PDF artwork retained, original PDF and extracted text included in saved canvas.')
  } catch (error) { setStatus(`FAIL: ${String(error)}`) }
  finally { setBusy(false) }
 }
 async function run() {
  setBusy(true); setStatus('Importing fixture…')
  try {
   const file = new File(['VAV,Floor,Room\nVAV-1,01,101\nVAV-2,02,201'], 'Room schedule.csv', { type: 'text/csv' })
   const id = await importDocument(editor, file)
   const start = Date.now()
   while (Date.now() - start < 30000) {
    const doc = readCanvasDocument(editor.getAsset(id)?.meta ?? {})
    if (doc?.status === 'error') throw new Error(doc.error)
    if (doc?.status === 'ready') break
    await new Promise(resolve => setTimeout(resolve, 100))
   }
   const doc = readCanvasDocument(editor.getAsset(id)?.meta ?? {})
   if (doc?.status !== 'ready' || !doc.extraction?.sections.some(s => s.text.includes('101'))) throw new Error('Extraction did not complete.')
   let found = false
   for (let n = 0; n < 50 && !found; n++) {
    const response = await fetch('/api/knowledge/retrieve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: { projectId: getProjectId(editor), connectionId: null, pluginIds: ['document-understanding'] }, request: { _type: 'knowledge', operation: 'search', query: doc.id, projectOnly: true } }) })
    const result = await response.json() as { matches?: unknown[] }
    found = Boolean(result.matches?.length)
    if (!found) await new Promise(resolve => setTimeout(resolve, 100))
   }
   if (!found) throw new Error('AI knowledge retrieval could not find the imported document.')
   const serialized = await serializeTldrawJson(editor)
   if (!serialized.includes(doc.source) || !serialized.includes('VAV-1')) throw new Error('Saved canvas lost source or extraction.')
   const snapshot = getSnapshot(editor.store); loadSnapshot(editor.store, snapshot)
   if (!readCanvasDocument(editor.getAsset(id)?.meta ?? {})?.extraction) throw new Error('Snapshot reload lost extraction.')
   editor.updateInstanceState({ isReadonly: true })
   let blocked = false
   try { await importDocument(editor, file) } catch { blocked = true }
   editor.updateInstanceState({ isReadonly: false })
   if (!blocked) throw new Error('Read-only import was not blocked.')
   setStatus('PASS: automatic extraction, source retention, AI retrieval, file save, snapshot reload and read-only guard.')
  } catch (error) { setStatus(`FAIL: ${String(error)}`) }
  finally { setBusy(false) }
 }
 return <><DocumentNotifications/><div style={{ position: 'absolute', top: 60, left: 16, width: 360, background: 'var(--tl-color-panel)', padding: 12, borderRadius: 8, pointerEvents: 'auto' }}>
  <p>Isolated document QA. No saved user canvas or station connection.</p>
  <TldrawUiButton type="normal" disabled={busy} onClick={run}><TldrawUiButtonLabel>Run document checks</TldrawUiButtonLabel></TldrawUiButton>
  <TldrawUiButton type="normal" disabled={busy} onClick={mediaChecks}><TldrawUiButtonLabel>Run image and PDF checks</TldrawUiButtonLabel></TldrawUiButton>
  <TldrawUiButton type="normal" onClick={choose}><TldrawUiButtonLabel>Import test document</TldrawUiButtonLabel></TldrawUiButton>
  <p role="status">{status}</p>
  {selected && <DocumentProperties shape={selected}/>}
 </div></>
}
const root = createRoot(document.getElementById('root')!)
root.render(<Tldraw shapeUtils={shapeUtils} components={{ InFrontOfTheCanvas: Controls, StylePanel: DefaultStylePanel }} onMount={editor => { editor.updateDocumentSettings({ meta: { basdrawProjectId: `document-qa-${crypto.randomUUID()}` } }) }}/> )
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())
