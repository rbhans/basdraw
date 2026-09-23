import assert from 'node:assert/strict'
import test from 'node:test'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import sharp from 'sharp'
import { capWarnings, decodeXmlEntities, extractDocument } from './document-extract.mjs'
import { documentChunks } from '../shared/documents.ts'
import { samplePdf } from './pdf-fixture.mjs'
import { deflateSync } from 'node:zlib'

test('CSV preserves quoted cells, embedded newlines, leading zeros and source rows', async () => {
 const result = await extractDocument(Buffer.from('VAV,Floor,Room,Notes\r\nVAV-1,01,001,"Conference, north"\r\nVAV-2,02,002,"two\nlines"'), 'schedule.csv')
 assert.deepEqual(result.sections[1].cells, ['VAV-1', '01', '001', 'Conference, north'])
 assert.equal(result.sections[2].cells[3], 'two\nlines')
 assert.equal(result.sections[2].location, 'Row 3')
})

test('XLSX retains sheet and cell locations, cached formulas and blank columns', async () => {
 const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('Floor 1')
 sheet.addRow(['VAV-1', null, '001', { formula: '1+1', result: 2 }])
 const result = await extractDocument(Buffer.from(await workbook.xlsx.writeBuffer()), 'schedule.xlsx')
 assert.equal(result.sections[0].sheet, 'Floor 1')
 assert.equal(result.sections[0].cells[2].address, 'C1')
 assert.equal(result.sections[0].cells[2].text, '001')
 assert.equal(result.sections[0].cells[3].formula, '1+1')
 assert.equal(result.sections[0].cells[3].text, '2')
})

test('DOCX preserves paragraph and table row boundaries without rendering document HTML', async () => {
 const zip = new JSZip()
 zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
 zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
 zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Room schedule</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>VAV-1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Room 101</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>')
 const result = await extractDocument(await zip.generateAsync({ type: 'nodebuffer' }), 'schedule.docx')
 assert.equal(result.sections[0].text, 'Room schedule')
 assert.deepEqual(result.sections[1].cells, ['VAV-1', 'Room 101'])
})

test('PDF text retains page provenance and OCR reads image-only source', async () => {
 const pdf = await extractDocument(Buffer.from(samplePdf()), 'control.pdf')
 assert.equal(pdf.pages, 2)
 assert.ok(pdf.sections.some(s => s.method === 'text' && s.page === 1 && s.text.includes('AHU-01')))
 const image = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="240"><rect width="1200" height="240" fill="white"/><text x="40" y="110" font-family="Arial" font-size="64" fill="black">VAV-1 serves Room 101</text></svg>')).png().toBuffer()
 const scan = await extractDocument(image, 'schedule.png')
 assert.match(scan.sections.map(s => s.text).join(' '), /Room 101/)
 assert.ok(scan.sections.every(s => s.method === 'ocr'))
 assert.ok(scan.warnings.some(w => w.includes('OCR')))
})

test('document reference chunks preserve long records and no-text provenance', () => {
 const doc = { id: 'source-id', name: 'large.txt', extraction: { hash: 'hash', warnings: [], sections: [{ location: 'Line 1', method: 'text', text: 'x'.repeat(180000) }] } }
 const chunks = documentChunks(doc)
 assert.ok(chunks.length > 1)
 assert.ok(chunks.every(chunk => chunk.length < 100000 && chunk.includes('source-id')))
 assert.equal([...chunks.join('').matchAll(/x{10,}/g)].reduce((n, match) => n + match[0].length, 0), 180000)
 assert.match(documentChunks({ ...doc, extraction: { ...doc.extraction, sections: [] } })[0], /No readable text/)
})

test('mixed PDF keeps digital text and OCRs scanned body even with a long selectable header', async () => {
 const { data, info } = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="240"><rect width="1200" height="240" fill="white"/><text x="40" y="110" font-family="Arial" font-size="64" fill="black">VAV-1 serves Room 101</text></svg>')).removeAlpha().raw().toBuffer({ resolveWithObject: true })
 const hex = deflateSync(data).toString('hex') + '>'
 const content = 'BT /F1 12 Tf 20 260 Td (Building A selectable header with more than forty characters) Tj ET\nq 600 0 0 120 0 60 cm /Im1 Do Q'
 const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 300] /Resources << /Font << /F1 5 0 R >> /XObject << /Im1 6 0 R >> >> /Contents 4 0 R >>',
  `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  `<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /FlateDecode] /Length ${hex.length} >>\nstream\n${hex}\nendstream`,
 ]
 let source = '%PDF-1.4\n'; const offsets = []
 objects.forEach((object, index) => { offsets.push(source.length); source += `${index + 1} 0 obj\n${object}\nendobj\n` })
 const xref = source.length
 source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
 const result = await extractDocument(Buffer.from(source), 'mixed-scan.pdf')
 assert.ok(result.sections.some(section => section.method === 'text' && section.text.includes('selectable header')))
 assert.ok(result.sections.some(section => section.method === 'ocr' && section.text.includes('Room 101')))
 assert.ok(result.sections.every(section => section.page === 1))
})

test('malformed and unsupported documents fail rather than indexing invented data', async () => {
 await assert.rejects(extractDocument(Buffer.from('invalid'), 'bad.pdf'))
 await assert.rejects(extractDocument(Buffer.from('invalid'), 'bad.xlsx'))
 await assert.rejects(extractDocument(Buffer.from('invalid'), 'bad.docx'))
 await assert.rejects(extractDocument(Buffer.from('invalid'), 'bad.exe'), /Export/)
})

test('XML entities from pdftotext decode once, without double-unescaping', () => {
 assert.equal(decodeXmlEntities('AHU-1 &amp; VAV &lt;2&gt; &quot;R&amp;D&quot; &apos;x&apos;'), 'AHU-1 & VAV <2> "R&D" \'x\'')
 assert.equal(decodeXmlEntities('&amp;lt;tag&amp;gt;'), '&lt;tag&gt;')
 assert.equal(decodeXmlEntities('&#176;F &#x2013; &custom; &#xD800;'), '°F – &custom; &#xD800;')
})

test('PDF text containing &, < and > is extracted literally', async () => {
 const content = 'BT /F1 14 Tf 20 150 Td (AHU-1 & VAV <2> R&D) Tj ET'
 const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
  `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
 ]
 let source = '%PDF-1.4\n'; const offsets = []
 objects.forEach((object, index) => { offsets.push(source.length); source += `${index + 1} 0 obj\n${object}\nendobj\n` })
 const xref = source.length
 source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
 const result = await extractDocument(Buffer.from(source), 'entities.pdf')
 const line = result.sections.find(section => section.method === 'text' && section.text.includes('AHU-1'))
 assert.equal(line.text, 'AHU-1 & VAV <2> R&D')
 assert.ok(line.words.some(word => word.text === '&'))
})

test('extraction warnings are capped in count and length', async () => {
 const capped = capWarnings([...Array.from({ length: 50 }, (_, i) => `Row ${i}: bad quote`), 'x'.repeat(1000)])
 assert.equal(capped.length, 21)
 assert.equal(capped[20], '(31 more warnings omitted)')
 assert.ok(capped.every(warning => warning.length <= 300))
 const csv = Array.from({ length: 60 }, (_, i) => `a,"b${i}`).join('\n')
 const result = await extractDocument(Buffer.from(csv), 'broken.csv')
 assert.ok(result.warnings.length <= 21)
})
