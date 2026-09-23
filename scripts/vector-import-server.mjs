// Separate from station connections: PDF import never logs in or sends files to Niagara.
import http from 'node:http'
import { convertVectorPdf, MAX_PDF_BYTES } from './vector-pdf.mjs'
import { fork } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { allowedOrigins, isTrustedOrigin, trustFailure } from './local-trust.mjs'

let busy = false
const port = Number(process.env.BASDRAW_PDF_PORT || 8790)
const origins = allowedOrigins()
const activeJobs = new Set()
http.createServer(async (request, response) => {
	const origin = request.headers.origin
	const allowed = isTrustedOrigin(origin, origins)
	const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json', ...(allowed ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}) }
	const reply = (status, body) => { response.writeHead(status, headers); response.end(JSON.stringify(body)) }
	// Loopback peer + exact loopback Host blocks DNS rebinding, including for /health.
	if (trustFailure(request, { port, origins })) return reply(403, { error: 'Only local basdraw pages may import files.' })
	if (request.method === 'GET' && request.url === '/health') return reply(200, { service: 'basdraw-vector-import', ok: true })
	// Imports come only from the basdraw page, so an allowlisted Origin is required.
	if (!allowed) return reply(403, { error: 'Only local basdraw pages may import files.' })
	if (request.method === 'OPTIONS') { response.writeHead(204, { ...headers, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type, X-Basdraw-Import' }); response.end(); return }
	const url = new URL(request.url, 'http://127.0.0.1')
	const document = url.pathname === '/document'
	if (request.method !== 'POST' || (!document && url.pathname !== '/pdf')) return reply(404, { error: 'Not found' })
	if ((!document && request.headers['content-type'] !== 'application/pdf') || request.headers['x-basdraw-import'] !== '1') return reply(415, { error: 'Expected a document upload.' })
	if (busy) return reply(429, { error: 'Another document is being processed. Try again shortly.' })
	if (Number(request.headers['content-length']) > MAX_PDF_BYTES) return reply(413, { error: 'Files must be 25 MB or smaller.' })
	busy = true
	request.setTimeout(15000, () => request.destroy())
	try {
		const chunks = []; let size = 0
		for await (const chunk of request) { size += chunk.length; if (size > MAX_PDF_BYTES) throw new Error('Files must be 25 MB or smaller.'); chunks.push(chunk) }
		request.setTimeout(0)
		const result = document
			? await processDocument(Buffer.concat(chunks), (url.searchParams.get('name') || 'document.txt').slice(0, 240), response)
			: await convertVectorPdf(Buffer.concat(chunks), Number(url.searchParams.get('page') || 1))
		reply(200, result)
	} catch (error) { if (!response.destroyed) reply(400, { error: error.message || 'Document import failed.' }) }
	finally { busy = false }
}).listen(port, '127.0.0.1', () => console.log(`basdraw vector import: http://127.0.0.1:${port}`))

// Extraction runs in a child process that leads its own process group. Killing the
// group on cancel/timeout also kills soffice, pdftocairo, pdftotext and tesseract
// helpers it spawned; a worker thread's terminate() would orphan them.
async function processDocument(bytes, name, response) {
	const directory = await mkdtemp(path.join(tmpdir(), 'basdraw-document-'))
	try {
		const input = path.join(directory, 'upload.bin')
		await writeFile(input, bytes)
		return await new Promise((resolve, reject) => {
			const child = fork(new URL('./document-worker.mjs', import.meta.url), [], {
				detached: process.platform !== 'win32',
				execArgv: [...process.execArgv, '--max-old-space-size=512'],
				serialization: 'advanced',
				stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
			})
			const job = { kill: () => killJob(child) }
			activeJobs.add(job)
			let done = false, outcome = null
			const exited = new Promise(resolveExit => child.once('exit', resolveExit))
			const finish = async (error, result) => {
				if (done) return
				done = true; clearTimeout(timer); response.off('close', cancel)
				killJob(child)
				// Wait for the group leader to die before the caller removes the directory.
				await Promise.race([exited, new Promise(resolveWait => setTimeout(resolveWait, 5000))])
				activeJobs.delete(job)
				if (error) reject(error); else resolve(result)
			}
			const cancel = () => finish(new Error('Document processing cancelled.'))
			const timer = setTimeout(() => finish(new Error('Document processing timed out. Split the file into smaller documents.')), 240_000)
			response.once('close', cancel)
			child.once('message', message => { outcome = message; finish(message.error ? new Error(message.error) : null, message.result) })
			child.once('error', error => finish(error))
			child.once('exit', code => { if (!done && !outcome) finish(new Error(`Document processor exited (${code}).`)) })
			child.send({ input, name, directory })
		})
	} finally {
		// Retries cover grandchildren that are still being reaped after SIGKILL.
		await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
	}
}

function killJob(child) {
	try {
		if (process.platform === 'win32') child.kill('SIGKILL')
		else process.kill(-child.pid, 'SIGKILL')
	} catch { /* Already exited. */ }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
	process.on(signal, () => {
		// Detached job groups do not receive the terminal's signal; kill them explicitly.
		for (const job of activeJobs) job.kill()
		process.exit(0)
	})
}
