import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import http from 'node:http'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'
import { allowedOrigins, defaultAllowedOrigins, isTrustedHost, isTrustedLocalRequest, isTrustedOrigin, trustFailure } from './local-trust.mjs'

const scripts = path.dirname(fileURLToPath(import.meta.url))
const appOrigin = 'http://127.0.0.1:5173'

const fakeRequest = (headers, remoteAddress = '127.0.0.1') => ({ headers, socket: { remoteAddress } })

test('trust helper accepts only loopback Host literals for the exact port', () => {
	assert.ok(isTrustedHost('127.0.0.1:8791', 8791))
	assert.ok(isTrustedHost('localhost:8791', 8791))
	assert.ok(isTrustedHost('[::1]:8791', 8791))
	assert.ok(isTrustedHost('LOCALHOST:8791', 8791))
	assert.ok(!isTrustedHost('127.0.0.1:8790', 8791))
	assert.ok(!isTrustedHost('127.0.0.1', 8791))
	// DNS rebinding: attacker hostname resolving to 127.0.0.1 still carries its own Host.
	assert.ok(!isTrustedHost('evil.example:8791', 8791))
	assert.ok(!isTrustedHost('127.0.0.1.evil.example:8791', 8791))
	assert.ok(!isTrustedHost(undefined, 8791))
})

test('trust helper limits origins to the app dev origins, overridable by env', () => {
	assert.deepEqual(allowedOrigins({}), defaultAllowedOrigins)
	assert.ok(isTrustedOrigin('http://127.0.0.1:5173', allowedOrigins({})))
	assert.ok(isTrustedOrigin('http://localhost:5173', allowedOrigins({})))
	assert.ok(!isTrustedOrigin('http://localhost:3000', allowedOrigins({})))
	assert.ok(!isTrustedOrigin('http://evil.example:5173', allowedOrigins({})))
	assert.ok(!isTrustedOrigin('null', allowedOrigins({})))
	const custom = allowedOrigins({ BASDRAW_ALLOWED_ORIGINS: ' http://localhost:4173 , not a url ' })
	assert.deepEqual(custom, ['http://localhost:4173'])
	assert.ok(!isTrustedOrigin(appOrigin, custom))
})

test('trust helper checks peer, Host and Origin together', () => {
	const options = { port: 8791, origins: defaultAllowedOrigins }
	assert.ok(isTrustedLocalRequest(fakeRequest({ host: '127.0.0.1:8791' }), options))
	assert.ok(isTrustedLocalRequest(fakeRequest({ host: '127.0.0.1:8791', origin: appOrigin }), options))
	assert.ok(isTrustedLocalRequest(fakeRequest({ host: 'localhost:8791' }, '::ffff:127.0.0.1'), options))
	assert.equal(trustFailure(fakeRequest({ host: '127.0.0.1:8791' }, '192.168.1.20'), options), 'non-loopback peer')
	assert.equal(trustFailure(fakeRequest({ host: 'rebind.evil.example:8791', origin: 'http://rebind.evil.example:8791' }), options), 'untrusted Host header')
	assert.equal(trustFailure(fakeRequest({ host: '127.0.0.1:8791', origin: 'http://evil.example' }), options), 'untrusted Origin header')
	assert.equal(trustFailure(fakeRequest({ host: '127.0.0.1:8791' }), { ...options, requireOrigin: true }), 'missing Origin header')
})

function startScript(name, env) {
	const child = spawn(process.execPath, [path.join(scripts, name)], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
	let output = ''
	const ready = new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`${name} did not start: ${output}`)), 15_000)
		const onData = (chunk) => {
			output += chunk
			if (/listening|bridge:|import:/i.test(output)) { clearTimeout(timer); resolve() }
		}
		child.stdout.on('data', onData)
		child.stderr.on('data', (chunk) => { output += chunk })
		child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`${name} exited (${code}): ${output}`)) })
	})
	return { child, ready, stop: () => new Promise((resolve) => {
		if (child.exitCode !== null || child.signalCode !== null) return resolve()
		child.once('exit', resolve)
		child.kill('SIGTERM')
	}) }
}

function openSocket(port, { origin = appOrigin, headers = {} } = {}) {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(`ws://127.0.0.1:${port}/baskstream`, { origin, headers })
		const messages = []
		const waiters = []
		socket.on('message', (data) => {
			const message = JSON.parse(data.toString('utf8'))
			const waiter = waiters.shift()
			if (waiter) waiter(message)
			else messages.push(message)
		})
		socket.once('open', () => resolve({ socket, next: () => messages.length ? Promise.resolve(messages.shift()) : new Promise((done) => waiters.push(done)) }))
		socket.once('error', reject)
		socket.once('unexpected-response', (_request, response) => reject(new Error(`HTTP ${response.statusCode}`)))
	})
}

test('baskStream bridge rejects bad frames without crashing and refuses rebinding upgrades', async (t) => {
	const port = 18788
	const bridge = startScript('baskstream-bridge.mjs', { BAS_WHITEBOARD_BRIDGE_PORT: String(port), BASDRAW_ALLOWED_ORIGINS: '' })
	t.after(bridge.stop)
	await bridge.ready

	await assert.rejects(openSocket(port, { headers: { Host: `rebind.evil.example:${port}` } }), /HTTP 401|Unexpected server response/)
	await assert.rejects(openSocket(port, { origin: 'http://localhost:3000' }), /HTTP 401|Unexpected server response/)

	const { socket, next } = await openSocket(port)
	for (const frame of ['null', '[]', '"text"', '42', '{bad json']) {
		socket.send(frame)
		const reply = await next()
		assert.equal(reply.op, 'error')
		assert.equal(reply.code, 'bad_request')
	}
	socket.send(JSON.stringify({ op: 'read', id: 'r1' }))
	assert.deepEqual(await next(), { op: 'error', id: 'r1', code: 'not_connected', message: 'Station WebSocket is not connected.' })
	socket.send(JSON.stringify({ op: 'connect_station', id: 'c0', stationUrl: '' }))
	assert.equal((await next()).code, 'connect_failed')
	assert.equal(bridge.child.exitCode, null)
	socket.close()
})

test('baskStream bridge rejects a second connect while one is in flight', async (t) => {
	// Local stand-in that accepts the login request and never answers (not a Niagara station).
	const held = new Set()
	const station = http.createServer((request) => { held.add(request.socket) })
	await new Promise((resolve) => station.listen(0, '127.0.0.1', resolve))
	t.after(() => new Promise((resolve) => { for (const s of held) s.destroy(); station.close(resolve) }))
	const port = 18789
	const bridge = startScript('baskstream-bridge.mjs', { BAS_WHITEBOARD_BRIDGE_PORT: String(port), BASDRAW_ALLOWED_ORIGINS: '' })
	t.after(bridge.stop)
	await bridge.ready

	const { socket, next } = await openSocket(port)
	const connect = { op: 'connect_station', stationUrl: `http://127.0.0.1:${station.address().port}`, username: 'user', password: 'password' }
	socket.send(JSON.stringify({ ...connect, id: 'first' }))
	await new Promise((resolve) => setTimeout(resolve, 200))
	socket.send(JSON.stringify({ ...connect, id: 'second' }))
	assert.deepEqual(await next(), { op: 'error', id: 'second', code: 'connect_in_progress', message: 'A station connection is already in progress.' })
	for (const s of held) s.destroy()
	const failed = await next()
	assert.equal(failed.id, 'first')
	assert.equal(failed.code, 'connect_failed')
	socket.close()
})

test('Codex bridge reports unavailable without codex on PATH and validates requests', async (t) => {
	const emptyPath = await mkdtemp(path.join(tmpdir(), 'basdraw-no-codex-'))
	t.after(() => rm(emptyPath, { recursive: true, force: true }))
	const port = 18791
	const bridge = startScript('codex-subscription-bridge.mjs', { BASDRAW_CODEX_PORT: String(port), PATH: emptyPath, BASDRAW_ALLOWED_ORIGINS: '' })
	t.after(bridge.stop)
	await bridge.ready

	const call = (pathname, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
		const request = http.request({ host: '127.0.0.1', port, path: pathname, method, headers: { 'X-Basdraw-Codex': '1', ...headers } }, (response) => {
			let text = ''
			response.on('data', (chunk) => { text += chunk })
			response.on('end', () => resolve({ status: response.statusCode, body: text ? JSON.parse(text) : null }))
		})
		request.on('error', reject)
		request.end(body)
	})

	await new Promise((resolve) => setTimeout(resolve, 300))
	const status = await call('/status')
	assert.equal(status.status, 200)
	assert.equal(status.body.available, false)
	assert.equal((await call('/status', { headers: { Host: `rebind.evil.example:${port}` } })).status, 403)
	assert.equal((await call('/status', { headers: { Origin: 'http://evil.example' } })).status, 403)
	const generate = (body) => call('/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
	const valid = { systemPrompt: 'x', input: [{ type: 'text', text: 'hi' }], outputSchema: { type: 'object' } }
	assert.equal((await generate({ ...valid, input: [{ type: 'localImage', path: '/etc/passwd' }] })).status, 400)
	assert.equal((await generate({ ...valid, input: [{ type: 'image', url: 'file:///etc/passwd' }] })).status, 400)
	assert.equal((await generate({ ...valid, model: { id: 'x' } })).status, 400)
	assert.equal((await generate({ ...valid, systemPrompt: 'x'.repeat(1_000_001) })).status, 400)
	assert.equal(bridge.child.exitCode, null)
})

test('import server enforces Host/Origin and extracts documents in a child process', async (t) => {
	const port = 18790
	const server = startScript('vector-import-server.mjs', { BASDRAW_PDF_PORT: String(port), BASDRAW_ALLOWED_ORIGINS: '' })
	t.after(server.stop)
	await server.ready
	const base = `http://127.0.0.1:${port}`
	assert.equal((await fetch(`${base}/health`)).status, 200)
	const post = (headers) => fetch(`${base}/document?name=points.csv`, { method: 'POST', headers: { 'X-Basdraw-Import': '1', 'Content-Type': 'application/octet-stream', ...headers }, body: 'Point,Value\nAHU-1 & VAV,<72>\n' })
	assert.equal((await post({})).status, 403)
	assert.equal((await post({ Origin: 'http://localhost:3000' })).status, 403)
	const response = await post({ Origin: appOrigin })
	assert.equal(response.status, 200)
	const result = await response.json()
	assert.deepEqual(result.sections[1].cells, ['AHU-1 & VAV', '<72>'])
	// Host rebinding is refused even for health checks (fetch cannot override Host, so use http).
	const rebound = await new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path: '/health', headers: { Host: `rebind.evil.example:${port}` } }, (res) => { res.resume(); resolve(res.statusCode) }).on('error', reject))
	assert.equal(rebound, 403)
})

test('cancelling a document import kills its converter subprocesses', { skip: process.platform === 'win32' }, async (t) => {
	const work = await mkdtemp(path.join(tmpdir(), 'basdraw-fake-office-'))
	t.after(() => rm(work, { recursive: true, force: true }))
	const pidFile = path.join(work, 'pid')
	const fakeOffice = path.join(work, 'soffice')
	// Stands in for a hung LibreOffice conversion.
	await writeFile(fakeOffice, `#!/bin/sh\necho $$ > '${pidFile}'\nexec sleep 60\n`)
	await chmod(fakeOffice, 0o755)
	const port = 18792
	const server = startScript('vector-import-server.mjs', { BASDRAW_PDF_PORT: String(port), BASDRAW_OFFICE_BIN: fakeOffice, BASDRAW_ALLOWED_ORIGINS: '' })
	t.after(server.stop)
	await server.ready

	const controller = new AbortController()
	const upload = fetch(`http://127.0.0.1:${port}/document?name=legacy.doc`, { method: 'POST', headers: { Origin: appOrigin, 'X-Basdraw-Import': '1' }, body: 'not really a doc', signal: controller.signal }).catch(() => null)
	let pid = null
	for (let i = 0; i < 100 && !pid; i++) {
		await new Promise((resolve) => setTimeout(resolve, 100))
		pid = Number(await readFile(pidFile, 'utf8').catch(() => '')) || null
	}
	assert.ok(pid, 'fake converter did not start')
	assert.doesNotThrow(() => process.kill(pid, 0))
	controller.abort()
	await upload
	let alive = true
	for (let i = 0; i < 50 && alive; i++) {
		await new Promise((resolve) => setTimeout(resolve, 100))
		try { process.kill(pid, 0) } catch { alive = false }
	}
	assert.equal(alive, false, 'converter subprocess survived cancellation')
})
