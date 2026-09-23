import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { XMLParser } from 'fast-xml-parser'
import Papa from 'papaparse'
import mammoth from 'mammoth'
import ExcelJS from 'exceljs'
import sharp from 'sharp'
import { createWorker } from 'tesseract.js'

const exec = promisify(execFile)
const require = createRequire(import.meta.url)
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024
const MAX_PAGES = 100, MAX_TEXT = 2_000_000, MAX_WARNINGS = 20, MAX_WARNING_CHARS = 300
const array = (value) => value == null ? [] : Array.isArray(value) ? value : [value]
// Entity processing stays off so DOCTYPE-declared entities can never expand; the
// predefined XML entities pdftotext emits are decoded explicitly by xmlText().
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', textNodeName: 'text', parseTagValue: false, processEntities: false })
const xmlEntities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** Single-pass decode of predefined and numeric XML entities ("&amp;lt;" becomes "&lt;", not "<"). */
export function decodeXmlEntities(value) {
 return String(value ?? '').replace(/&(?:(amp|lt|gt|quot|apos)|#(\d{1,7})|#x([0-9a-f]{1,6}));/gi, (match, name, decimal, hex) => {
  if (name) return xmlEntities[name.toLowerCase()] ?? match
  const code = decimal ? Number(decimal) : parseInt(hex, 16)
  return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : match
 })
}

/** Keeps extraction warnings readable: at most MAX_WARNINGS, each at most MAX_WARNING_CHARS. */
export function capWarnings(warnings) {
 const unique = [...new Set(array(warnings).map(warning => String(warning)))]
 const kept = unique.slice(0, MAX_WARNINGS).map(warning => warning.length > MAX_WARNING_CHARS ? `${warning.slice(0, MAX_WARNING_CHARS - 1)}…` : warning)
 return unique.length > MAX_WARNINGS ? [...kept, `(${unique.length - MAX_WARNINGS} more warnings omitted)`] : kept
}

// Maps a missing executable (spawn ENOENT) to install guidance; other failures pass through.
async function run(command, args, options, missing) {
 try { return await exec(command, args, options) }
 catch (error) {
  if (error.code === 'ENOENT' && String(error.syscall ?? '').startsWith('spawn')) throw new Error(missing)
  throw error
 }
}
const POPPLER_MISSING = 'PDF extraction needs Poppler (pdfinfo, pdftotext, pdfimages, pdftocairo) on PATH. On macOS: brew install poppler. Then restart the import service.'
export const documentExtensions = ['pdf', 'docx', 'doc', 'rtf', 'odt', 'xlsx', 'xls', 'ods', 'csv', 'txt', 'md', 'tsv', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'tif', 'tiff', 'bmp', 'svg']

/** Extractors return source locations, never guessed equipment mappings or executable instructions. */
export async function extractDocument(bytes, name, taskDirectory) {
 if (bytes.length > MAX_DOCUMENT_BYTES) throw new Error('Documents must be 25 MB or smaller.')
 const extension = name.split('.').pop().toLowerCase()
 const extractor = extractors[extension]
 if (!extractor) throw new Error('Use PDF, DOCX, XLSX, CSV, TXT or an image. Export Google Docs/Sheets or older Office files to one of these formats.')
 const directory = taskDirectory ?? await mkdtemp(path.join(tmpdir(), 'basdraw-document-'))
 let worker
 const ocr = async (image, page = 1) => {
  worker ??= await createWorker('eng', 1, { langPath: path.dirname(require.resolve('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz')), cacheMethod: 'none' })
  const { data } = await worker.recognize(image, {}, { text: true, blocks: true })
  const lines = (data.blocks ?? []).flatMap(b => b.paragraphs.flatMap(p => p.lines))
  return lines.length ? lines.map((line, i) => ({ location: `Page ${page}, OCR line ${i + 1}`, page, method: 'ocr', confidence: line.confidence, bounds: line.bbox, text: line.text.trim() }))
   : [{ location: `Page ${page}`, page, method: 'ocr', confidence: data.confidence, text: data.text.trim() }]
 }
 try {
  const result = await extractor({ bytes, name, directory, ocr, extension })
  if (result.sections.reduce((n, section) => n + section.text.length, 0) > MAX_TEXT) throw new Error('This document exceeds the 2 million character limit. Split it into smaller files.')
  return { version: 1, hash: createHash('sha256').update(bytes).digest('hex'), name, ...result,
   warnings: [...capWarnings(result.warnings ?? []), ...(result.sections.some(s => s.method === 'ocr') ? ['OCR text may contain mistakes. Verify equipment IDs, numbers and table associations against the source before station changes.'] : [])] }
 } finally { try { await worker?.terminate() } finally { if (!taskDirectory) await rm(directory, { recursive: true, force: true }) } }
}

async function pdf({ bytes, directory, ocr }) {
 const input = path.join(directory, 'input.pdf')
 await writeFile(input, bytes)
 const { stdout } = await run('pdfinfo', [input], { timeout: 15000, maxBuffer: 1_000_000 }, POPPLER_MISSING)
 const count = Number(/^Pages:\s+(\d+)/m.exec(stdout)?.[1])
 if (!count || count > MAX_PAGES) throw new Error(`PDFs must contain 1–${MAX_PAGES} pages. Split larger files first.`)
 await run('pdftotext', ['-bbox-layout', input, path.join(directory, 'text.html')], { timeout: 30000, maxBuffer: 1_000_000 }, POPPLER_MISSING)
 const parsed = xml.parse(await readFile(path.join(directory, 'text.html'), 'utf8'))
 const pages = array(parsed.html?.body?.doc?.page)
 // Pages with raster content also get OCR, even if a selectable header/footer exists.
 // One line per image: image-heavy drawings easily exceed 1 MB of listing.
 const images = await run('pdfimages', ['-list', input], { timeout: 15000, maxBuffer: 64 * 1024 * 1024 }, POPPLER_MISSING)
 const rasterPages = new Set(images.stdout.split('\n').filter(line => /^\s*\d+\s+\d+\s+image\s/.test(line)).map(line => Number(line.trim().split(/\s+/)[0])))
 const sections = []; let preview = ''
 for (let index = 0; index < count; index++) {
  const page = pages[index] ?? {}, number = index + 1
  const lines = array(page.flow).flatMap(flow => array(flow.block)).flatMap(block => array(block.line))
  const digital = lines.map((line, row) => ({ location: `Page ${number}, line ${row + 1}`, page: number, method: 'text',
   bounds: { x: Number(line.xMin), y: Number(line.yMin), w: Number(line.xMax) - Number(line.xMin), h: Number(line.yMax) - Number(line.yMin) },
   words: array(line.word).map(word => ({ text: decodeXmlEntities(word.text), x: Number(word.xMin), y: Number(word.yMin) })),
   text: array(line.word).map(word => decodeXmlEntities(word.text)).join(' ') })).filter(line => line.text.trim())
  sections.push(...digital)
  const needsOcr = rasterPages.has(number) || digital.reduce((n, s) => n + s.text.length, 0) < 40
  if (index === 0 || needsOcr) {
   const prefix = path.join(directory, `page-${number}`)
   await run('pdftocairo', ['-png', '-singlefile', '-f', String(number), '-l', String(number), '-scale-to', '2400', input, prefix], { timeout: 30000, maxBuffer: 1_000_000 }, POPPLER_MISSING)
   const image = await readFile(`${prefix}.png`)
   if (index === 0) preview = await thumbnail(image)
   if (needsOcr) sections.push(...await ocr(image, number))
  }
 }
 return { sections, preview, pages: count, warnings: ['PDF text positions preserve page layout; columns are not guaranteed table cells. OCR bounds use rendered-page pixels; PDF text bounds use PDF points.'] }
}

async function word({ bytes }) {
 const result = await mammoth.convertToHtml({ buffer: bytes }, { includeDefaultStyleMap: true, convertImage: mammoth.images.imgElement(() => ({ src: '' })) })
 // Parse generated markup as data only. It is never mounted as HTML in the browser.
 const { default: parse } = await import('node-html-parser')
 const root = parse(result.value)
 const sections = []; let tableNumber = 0
 for (const element of root.querySelectorAll('p,h1,h2,h3,h4,table')) {
  if (element.closest('table') && element.tagName !== 'TABLE') continue
  if (element.tagName === 'TABLE') {
   const table = ++tableNumber
   element.querySelectorAll('tr').forEach((row, index) => {
    const cells = row.querySelectorAll('th,td').map(cell => cell.textContent)
    sections.push({ location: `Table ${table}, row ${index + 1}`, table, row: index + 1, cells, method: 'text', text: cells.join(' | ') })
   })
  } else if (element.textContent.trim()) sections.push({ location: `Paragraph ${sections.length + 1}`, method: 'text', text: element.textContent })
 }
 return { sections, warnings: result.messages.map(m => m.message), pages: null }
}

async function spreadsheet({ bytes }) {
 const workbook = new ExcelJS.Workbook()
 await workbook.xlsx.load(bytes)
 const sections = []; const warnings = []
 workbook.eachSheet(sheet => {
  if (sheet.state !== 'visible') warnings.push(`Includes hidden sheet: ${sheet.name}`)
  sheet.eachRow((row, index) => {
   const cells = []
   if (row.cellCount > 16384 || sections.length > 50000) throw new Error('Spreadsheet is too large. Split it into smaller files.')
   row.eachCell({ includeEmpty: true }, cell => {
    if (cell.formula && cell.result === undefined) warnings.push(`Formula has no cached result: ${sheet.name}!${cell.address}`)
    cells.push({ address: cell.address, text: cell.text, ...(cell.formula ? { formula: cell.formula } : {}) })
   })
   sections.push({ location: `${sheet.name}!row ${index}`, sheet: sheet.name, row: index, cells, method: 'text', text: cells.map(c => `${c.address}: ${c.text}`).join(' | ') })
  })
 })
 return { sections, warnings: [...new Set(warnings)].slice(0, 100), pages: null }
}

async function textFile({ bytes, extension }) {
 const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
 if (extension === 'csv' || extension === 'tsv') {
  const parsed = Papa.parse(text, { skipEmptyLines: 'greedy', delimiter: extension === 'tsv' ? '\t' : '', dynamicTyping: false })
  return { sections: parsed.data.map((cells, index) => ({ location: `Row ${index + 1}`, row: index + 1, cells, method: 'text', text: cells.join(' | ') })), pages: null, warnings: parsed.errors.map(e => `Row ${e.row ?? '?'}: ${e.message}`) }
 }
 return { sections: text.split(/\r?\n/).map((text, index) => ({ location: `Line ${index + 1}`, method: 'text', text })), pages: null }
}

async function image({ bytes, ocr }) {
 const normalized = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 3200, height: 3200, fit: 'inside', withoutEnlargement: true }).png().toBuffer()
 return { sections: await ocr(normalized), preview: await thumbnail(normalized), pages: 1, warnings: ['Image OCR reads the first frame/page. Animated media remains unchanged on the canvas.'] }
}

async function office(context) {
 const input = path.join(context.directory, `source.${context.extension}`)
 await writeFile(input, context.bytes)
 const format = ['xls', 'ods'].includes(context.extension) ? 'xlsx' : 'pdf'
 await run(process.env.BASDRAW_OFFICE_BIN || 'soffice', [`-env:UserInstallation=${pathToFileURL(path.join(context.directory, 'office-profile')).href}`, '--headless', '--convert-to', format, '--outdir', context.directory, input], { timeout: 60000, maxBuffer: 1_000_000 },
  'Older Office/OpenDocument formats require LibreOffice (soffice), or export this file to PDF, DOCX or XLSX. BASDRAW_OFFICE_BIN can specify the executable.')
 // soffice exits 0 even when conversion fails, so a missing output means the file could not be converted.
 let converted
 try { converted = await readFile(path.join(context.directory, `source.${format}`)) }
 catch (error) {
  if (error.code === 'ENOENT') throw new Error('LibreOffice could not convert this file. Check that it is valid and not password-protected, or export it to PDF, DOCX or XLSX.')
  throw error
 }
 const result = await (format === 'xlsx' ? spreadsheet : pdf)({ ...context, bytes: converted })
 return { ...result, warnings: ['Converted with LibreOffice. Source locations refer to the converted document. The original file is retained.', ...(result.warnings ?? [])] }
}
async function thumbnail(bytes) { return `data:image/png;base64,${(await sharp(bytes).resize({ width: 800, height: 1000, fit: 'inside', withoutEnlargement: true }).png().toBuffer()).toString('base64')}` }

// Extend this registry when adding a format. All parsers share the same result contract.
const extractors = { pdf, docx: word, doc: office, rtf: office, odt: office, xls: office, ods: office, xlsx: spreadsheet, csv: textFile, tsv: textFile, txt: textFile, md: textFile,
 png: image, jpg: image, jpeg: image, webp: image, gif: image, tif: image, tiff: image, bmp: image, svg: image }
