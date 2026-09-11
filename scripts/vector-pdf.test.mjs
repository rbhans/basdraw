import test from 'node:test'
import assert from 'node:assert/strict'
import { convertVectorPdf, MAX_PDF_BYTES } from './vector-pdf.mjs'
import { samplePdf } from './pdf-fixture.mjs'

test('converts paths, clipping, fonts and only the requested page', async () => {
	const first = await convertVectorPdf(Buffer.from(samplePdf()))
	assert.equal(first.pages, 2)
	assert.match(first.svg, /<path/)
	assert.match(first.svg, /clipPath/)
	assert.match(first.svg, /<use/)
	const second = await convertVectorPdf(Buffer.from(samplePdf()), 2)
	assert.equal(second.page, 2)
	assert.match(second.svg, /viewBox="0 0 300 200"/)
	assert.doesNotMatch(second.svg, /<use/)
})
test('invalid files, oversized files and invalid page selections fail safely', async () => {
	await assert.rejects(convertVectorPdf(Buffer.from('not a pdf')), /not a PDF/)
	await assert.rejects(convertVectorPdf(Buffer.alloc(MAX_PDF_BYTES + 1)), /25 MB/)
	await assert.rejects(convertVectorPdf(Buffer.from(samplePdf()), 0), /valid page/)
	await assert.rejects(convertVectorPdf(Buffer.from(samplePdf()), 3), /between 1 and 2/)
})
