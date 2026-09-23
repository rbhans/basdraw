import { AssetRecordType, FileHelpers, atom, createShapeId, createShapesForAssets, defaultHandleExternalFileContent, type TLDefaultExternalContentHandlerOpts, type Editor, type JsonValue, type TLAssetId, type TLShapeId } from 'tldraw'
import { type CanvasDocument, type DocumentExtraction, documentChunks, sha256Hex } from '../../shared/documents'
import { getProjectId } from '../knowledge/currentKnowledgeScope'

export const DOCUMENT_TYPE = 'bas-document' as const
const documentJson = (doc: CanvasDocument): JsonValue => JSON.parse(JSON.stringify(doc)) as JsonValue
export const documentAccept = '.pdf,.docx,.doc,.rtf,.odt,.xlsx,.xls,.ods,.csv,.tsv,.txt,.md,.png,.jpg,.jpeg,.webp,.gif,.tif,.tiff,.bmp,.svg'
export function supportedDocument(name: string) { return documentAccept.split(',').some(ext => name.toLowerCase().endsWith(ext)) }
export function readCanvasDocument(meta: Record<string, unknown>): CanvasDocument | null {
 const value = meta.basDocument as CanvasDocument | undefined
 return value?.id && typeof value.source === 'string' && typeof value.name === 'string' ? value : null
}

const runtimes = new WeakMap<Editor, { enqueue: (id: TLAssetId) => void; confirm: (ids: TLAssetId[]) => void }>()
/**
 * Documents whose source bytes were imported by this user in this session, keyed by
 * `${document.id}:${sha256(source)}`. Anything else (an opened .tldr, pasted content,
 * a restored tab) is untrusted: its embedded extraction and project id came from the
 * file, so it is indexed only after the user confirms and is then re-extracted.
 */
const trustedSources = new WeakMap<Editor, Set<string>>()
const trusted = (editor: Editor) => { let set = trustedSources.get(editor); if (!set) trustedSources.set(editor, set = new Set()); return set }
/** Assets awaiting the user's confirmation before indexing, with the project they would be indexed into. */
const $awaiting = atom('bas documents awaiting index confirmation', new Map<TLAssetId, string>())

export function documentIndexState(editor: Editor, assetId: TLAssetId): 'awaiting-confirmation' | null {
 return $awaiting.get().get(assetId) === getProjectId(editor) ? 'awaiting-confirmation' : null
}
export function confirmDocumentIndexing(editor: Editor, assetIds?: TLAssetId[]) {
 const projectId = getProjectId(editor)
 runtimes.get(editor)?.confirm(assetIds ?? [...$awaiting.get()].filter(([, project]) => project === projectId).map(([id]) => id))
}
function setAwaiting(assetId: TLAssetId, projectId: string | null) {
 const next = new Map($awaiting.get())
 if (projectId === null) next.delete(assetId); else next.set(assetId, projectId)
 $awaiting.set(next)
}
async function sourceHash(document: CanvasDocument) {
 if (!document.source.startsWith('data:')) throw new Error('Document source must be embedded in this canvas.')
 return sha256Hex(await (await fetch(document.source)).arrayBuffer())
}

/** A normal tldraw image asset retains the source and extraction in its portable metadata. */
export async function importDocument(editor: Editor, file: File, point?: { x: number; y: number }, attachTo?: TLShapeId) {
 if (editor.getIsReadonly()) throw new Error('This canvas is read-only.')
 if (file.size > 25 * 1024 * 1024) throw new Error('Documents must be 25 MB or smaller.')
 if (!supportedDocument(file.name)) throw new Error('Export this file to PDF, DOCX, XLSX, CSV or TXT first.')
 const project = getProjectId(editor), pageId = editor.getCurrentPageId()
 const source = await FileHelpers.blobToDataUrl(file)
 if (editor.getIsReadonly() || project !== getProjectId(editor) || pageId !== editor.getCurrentPageId()) throw new Error('Canvas changed during import. Please try again.')
 const paper = attachTo ? editor.getSortedChildIdsForParent(attachTo).map(id => editor.getShape(id)).find(shape => shape?.type === 'image' && shape.isLocked) : undefined
 const paperAsset = paper?.type === 'image' && paper.props.assetId ? editor.getAsset(paper.props.assetId) : undefined
 const assetId = paperAsset?.id ?? AssetRecordType.createId()
 const document: CanvasDocument = { id: crypto.randomUUID(), name: file.name, mime: file.type || 'application/octet-stream', source, status: 'pending' }
 trusted(editor).add(`${document.id}:${await sha256Hex(await file.arrayBuffer())}`)
 const placeholder = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="600"><rect width="480" height="600" fill="white"/><path d="M100 130h280M100 180h280M100 230h220" stroke="#aaa" stroke-width="8"/></svg>')
 editor.markHistoryStoppingPoint('import document')
 editor.run(() => {
  if (paperAsset) editor.updateAssets([{ ...paperAsset, meta: { ...paperAsset.meta, basDocument: document as unknown as JsonValue, basPreserveImage: true } }])
  else editor.createAssets([{ id: assetId, type: 'image', typeName: 'asset', props: { name: file.name, src: placeholder, w: 480, h: 600, mimeType: 'image/svg+xml', isAnimated: false }, meta: { basDocument: document as unknown as JsonValue } }])
  if (attachTo && editor.getShape(attachTo)) {
   const shape = editor.getShape(attachTo)!
   editor.updateShape({ id: shape.id, type: shape.type, meta: { ...shape.meta, basDocumentAssetId: assetId } })
  } else {
   const id = createShapeId(), center = point ?? editor.getViewportPageBounds().center
   editor.createShape({ id, type: DOCUMENT_TYPE, x: center.x - 240, y: center.y - 300, props: { w: 480, h: 600, assetId, title: file.name } })
   editor.select(id)
  }
 })
 runtimes.get(editor)?.enqueue(assetId)
 return assetId
}

export async function documentFile(document: CanvasDocument) {
 if (!document.source.startsWith('data:')) throw new Error('Document source must be embedded in this canvas.')
 return new File([await (await fetch(document.source)).blob()], document.name, { type: document.mime })
}

export function retryDocument(editor: Editor, assetId: TLAssetId) {
 const asset = editor.getAsset(assetId), doc = asset && readCanvasDocument(asset.meta)
 if (!asset || !doc || editor.getIsReadonly()) return
 editor.updateAssets([{ ...asset, meta: { ...asset.meta, basDocument: documentJson({ ...doc, status: doc.extraction ? 'processing' : 'pending', error: undefined }) } }])
 // Retry is an explicit user request to read and index this source.
 runtimes.get(editor)?.confirm([assetId])
}

export function installDocumentRuntime(editor: Editor, options: TLDefaultExternalContentHandlerOpts) {
 let stopped = false, running = false, timer: ReturnType<typeof setTimeout> | undefined
 const queue = new Set<TLAssetId>(), indexed = new Set<string>(), attempted = new Set<string>(), confirmed = new Set<TLAssetId>()
 const controller = new AbortController()
 const toastId = 'bas-document-index-confirm'
 const entryId = async (projectId: string, docId: string, hash: string, index: number) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${projectId}:${docId}:${hash}:${index}`))
  return 'document-' + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
 }
 const alreadyIndexed = async (projectId: string, docId: string, hash: string) => {
  const response = await fetch(`/api/knowledge/${await entryId(projectId, docId, hash, 0)}`, { signal: controller.signal })
  return response.ok
 }
 const promptForConfirmation = () => {
  const projectId = getProjectId(editor)
  const count = [...$awaiting.get().values()].filter(project => project === projectId).length
  options.toasts.removeToast(toastId)
  if (!count || stopped) return
  options.toasts.addToast({
   id: toastId, severity: 'info', keepOpen: true,
   title: count === 1 ? 'Index a document from this file?' : `Index ${count} documents from this file?`,
   description: `This canvas contains ${count === 1 ? 'a document that is' : 'documents that are'} not yet in project knowledge "${projectId.slice(0, 80)}". Indexing re-reads the original files so the AI can search them. Only index files you trust.`,
   actions: [
    { type: 'primary', label: 'Index', onClick: () => confirmDocumentIndexing(editor) },
    { type: 'normal', label: 'Not now', onClick: () => options.toasts.removeToast(toastId) },
   ],
  })
 }
 const referenced = (id: TLAssetId) => editor.store.allRecords().some(record => record.typeName === 'shape' && ((record.props as { assetId?: string }).assetId === id || record.meta.basDocumentAssetId === id))
 const update = (id: TLAssetId, doc: CanvasDocument) => {
  const asset = editor.getAsset(id)
  if (asset?.type === 'image' && !stopped && !editor.getIsReadonly() && referenced(id)) editor.updateAssets([{ ...asset, meta: { ...asset.meta, basDocument: documentJson(doc) }, ...(!asset.meta.basPreserveImage && doc.extraction?.preview ? { props: { ...asset.props, src: doc.extraction.preview, mimeType: 'image/png' } } : {}) }])
 }
 async function run() {
  if (running || stopped || editor.getIsReadonly()) return
  running = true
  try {
   for (const id of queue) {
    queue.delete(id)
    if (stopped || editor.getIsReadonly()) break
    const projectId = getProjectId(editor), asset = editor.getAsset(id)
    let doc = asset && readCanvasDocument(asset.meta)
    if (!doc || !referenced(id)) continue
    const sourceId = doc.id
    const valid = () => !stopped && !editor.getIsReadonly() && projectId === getProjectId(editor) && referenced(id) && readCanvasDocument(editor.getAsset(id)?.meta ?? {})?.id === sourceId
    try {
     const hash = await sourceHash(doc)
     const trustKey = `${doc.id}:${hash}`
     const userConfirmed = confirmed.delete(id)
     if (userConfirmed) trusted(editor).add(trustKey)
     if (!trusted(editor).has(trustKey)) {
      // Never index file-supplied extraction text into a file-supplied project without the user.
      if (await alreadyIndexed(projectId, doc.id, hash)) { indexed.add(`${projectId}:${doc.id}:${hash}`); continue }
      if (valid()) { setAwaiting(id, projectId); promptForConfirmation() }
      continue
     }
     setAwaiting(id, null)
     // Only an extraction produced in this session from these exact bytes is indexed.
     if (!doc.extraction || doc.extraction.hash !== hash || userConfirmed) {
      update(id, { ...doc, status: 'processing', error: undefined })
      const file = await documentFile(doc)
      const response = await fetch(`http://127.0.0.1:8790/document?name=${encodeURIComponent(doc.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Basdraw-Import': '1' }, body: file, signal: controller.signal })
      const result = await response.json() as DocumentExtraction & { error?: string }
      if (!response.ok) throw new Error(result.error || 'Document processing failed.')
      if (!Array.isArray(result.sections) || !result.hash) throw new Error('Invalid document extraction response.')
      if (result.hash !== hash) throw new Error('Extraction does not match the document source.')
      if (!valid()) continue
      doc = { ...doc, status: 'processing', extraction: result, error: undefined }
      update(id, doc)
     }
     if (!valid()) continue
     const key = `${projectId}:${doc.id}:${hash}`
     if (indexed.has(key)) { if (doc.status !== 'ready') update(id, { ...doc, status: 'ready', error: undefined }); continue }
     const chunks = documentChunks(doc)
     for (let index = 0; index < chunks.length; index++) {
      if (!valid()) break
      const entry = { id: await entryId(projectId, doc.id, hash, index), kind: 'reference', title: `${doc.name.slice(0, 120)} · part ${index + 1}/${chunks.length}`, description: `Imported document ${doc.id}. Source locations and ${doc.extraction!.sections.some(s => s.method === 'ocr') ? 'OCR' : 'extracted'} text.`, content: chunks[index], scopeType: 'project', scopeId: projectId, pluginId: 'document-understanding', source: 'canvas-document', tags: ['document', doc.id], enabled: true }
      const response = await fetch('/api/knowledge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry), signal: controller.signal })
      if (!response.ok && response.status !== 409) throw new Error('Document was read, but project knowledge could not be saved. Start the backend and retry indexing.')
     }
     if (valid()) { indexed.add(key); update(id, { ...doc, status: 'ready', error: undefined }) }
    } catch (error) { if (valid()) update(id, { ...doc, status: 'error', error: error instanceof Error ? error.message : String(error) }) }
   }
  } finally { running = false }
 }
 const enqueue = (id: TLAssetId) => { queue.add(id); void run() }
 const confirm = (ids: TLAssetId[]) => {
  if (editor.getIsReadonly()) return
  options.toasts.removeToast(toastId)
  for (const id of ids) { confirmed.add(id); setAwaiting(id, null); enqueue(id) }
 }
 const scan = () => {
  clearTimeout(timer)
  timer = setTimeout(() => {
   if (editor.getIsReadonly()) { attempted.clear(); return }
   for (const asset of editor.getAssets()) {
    const doc = readCanvasDocument(asset.meta)
    const key = `${getProjectId(editor)}:${asset.id}`
    if (!doc || !referenced(asset.id) || attempted.has(key)) continue
    attempted.add(key); enqueue(asset.id)
   }
  }, 300)
 }
 editor.registerExternalContentHandler('files', async info => {
  if (editor.getIsReadonly()) return
  for (const file of info.files) {
   const image = /\.(png|jpe?g|webp|gif|svg|bmp)$/i.test(file.name)
   if (supportedDocument(file.name) && !image) {
    try { await importDocument(editor, file, info.point) } catch (error) { window.dispatchEvent(new CustomEvent('basdraw-document-error', { detail: String(error) })) }
   } else if (image && file.size <= 25 * 1024 * 1024) {
    try {
     const project = getProjectId(editor), page = editor.getCurrentPageId()
     // Await native sanitization/upload before adding metadata. The default files handler
     // uploads asynchronously and would otherwise overwrite the extraction metadata later.
     const asset = await editor.getAssetForExternalContent({ type: 'file', file })
     if (!asset || asset.type !== 'image') throw new Error('Could not load image.')
     const source = await FileHelpers.blobToDataUrl(file)
     if (stopped || editor.getIsReadonly() || project !== getProjectId(editor) || page !== editor.getCurrentPageId()) return
     const existing = editor.getAsset(asset.id)
     const doc = existing && readCanvasDocument(existing.meta) || { id: crypto.randomUUID(), name: file.name, mime: file.type, source, status: 'pending' as const }
     trusted(editor).add(`${doc.id}:${await sha256Hex(await file.arrayBuffer())}`)
     const enhanced = { ...asset, meta: { ...asset.meta, basDocument: documentJson(doc), basPreserveImage: true } }
     if (existing) editor.updateAssets([enhanced])
     await createShapesForAssets(editor, [enhanced], info.point ?? editor.getViewportPageBounds().center)
     enqueue(asset.id)
    } catch (error) { options.toasts.addToast({ title: 'Image import failed', description: String(error), severity: 'error' }) }
   } else await defaultHandleExternalFileContent(editor, { ...info, files: [file] }, options)
  }
 })
 const unlisten = editor.store.listen(scan)
 runtimes.set(editor, { enqueue, confirm }); scan()
 return () => { stopped = true; controller.abort(); clearTimeout(timer); unlisten(); runtimes.delete(editor); options.toasts.removeToast(toastId); $awaiting.set(new Map()); editor.registerExternalContentHandler('files', info => defaultHandleExternalFileContent(editor, info, options)) }
}
