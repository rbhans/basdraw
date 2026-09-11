// Separate from station connections: PDF import never logs in or sends files to Niagara.
import http from 'node:http'
import { convertVectorPdf, MAX_PDF_BYTES } from './vector-pdf.mjs'

let busy = false
const port = Number(process.env.BASDRAW_PDF_PORT || 8790)
http.createServer(async (request, response) => {
	const origin = request.headers.origin
	let allowed = false
	try { const url = new URL(origin); allowed = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) } catch { /* No origin is allowed only for health checks. */ }
	const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json', ...(allowed ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}) }
	const reply = (status, body) => { response.writeHead(status, headers); response.end(JSON.stringify(body)) }
	if (request.method === 'GET' && request.url === '/health') return reply(200, { service: 'basdraw-vector-import', ok: true })
	if (!allowed) return reply(403, { error: 'Only local basdraw pages may import files.' })
	if (request.method === 'OPTIONS') { response.writeHead(204, { ...headers, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type, X-Basdraw-Import' }); response.end(); return }
	const url = new URL(request.url, 'http://127.0.0.1')
	if (request.method !== 'POST' || url.pathname !== '/pdf') return reply(404, { error: 'Not found' })
	if (request.headers['content-type'] !== 'application/pdf' || request.headers['x-basdraw-import'] !== '1') return reply(415, { error: 'Expected a PDF upload.' })
	if (busy) return reply(429, { error: 'Another PDF is being converted. Try again shortly.' })
	if (Number(request.headers['content-length']) > MAX_PDF_BYTES) return reply(413, { error: 'PDF files must be 25 MB or smaller.' })
	busy = true
	request.setTimeout(15000, () => request.destroy())
	try {
		const chunks = []; let size = 0
		for await (const chunk of request) { size += chunk.length; if (size > MAX_PDF_BYTES) throw new Error('PDF files must be 25 MB or smaller.'); chunks.push(chunk) }
		const result = await convertVectorPdf(Buffer.concat(chunks), Number(url.searchParams.get('page') || 1))
		reply(200, result)
	} catch (error) { if (!response.destroyed) reply(400, { error: error.message || 'PDF import failed.' }) }
	finally { busy = false }
}).listen(port, '127.0.0.1', () => console.log(`basdraw vector import: http://127.0.0.1:${port}`))
