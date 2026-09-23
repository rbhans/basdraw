import crypto from 'node:crypto'
import http from 'node:http'
import https from 'node:https'
import { decode, encode } from '@msgpack/msgpack'
import { WebSocket, WebSocketServer } from 'ws'
import { baskstreamWriteOperations, validateBaskstreamInput } from '../shared/baskstreamProtocol.ts'
import { trustFailure } from './local-trust.mjs'

const host = '127.0.0.1'
const port = Number(process.env.BAS_WHITEBOARD_BRIDGE_PORT || 8788)
const maxStationResponseBytes = 8 * 1024 * 1024
const maxScramIterations = 1_000_000
const readOnlyOperations = new Set([
	'browse',
	'capabilities',
	'describe',
	'describe_history',
	'describe_write',
	'ping',
	'read',
	'read_alarms',
	'read_history',
	'read_schedule',
	'read_tags',
	'release_subscriptions',
	'renew_subscriptions',
	'replace_subscriptions',
	'search',
	'subscribe',
	'subscribe_alarms',
	'subscribe_model',
	'subscription_status',
	'unsubscribe',
	'unsubscribe_alarms',
	'unsubscribe_model',
])

const server = http.createServer((request, response) => {
	if (request.method === 'GET' && request.url === '/health') {
		response.writeHead(200, {
			'Cache-Control': 'no-store',
			'Content-Type': 'application/json; charset=utf-8',
		})
		response.end(JSON.stringify({ service: 'basdraw-baskstream-bridge', ok: true }))
		return
	}
	response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
	response.end('Not found')
})

const browserSockets = new WebSocketServer({ server, path: '/baskstream', maxPayload: 1024 * 1024, verifyClient: ({ req }) => {
	const failure = trustFailure(req, { port, requireOrigin: true })
	if (failure) console.warn(`baskStream bridge: rejected WebSocket upgrade (${failure}).`)
	return !failure
} })

browserSockets.on('connection', (browser) => {
	let station = null
	let connecting = false
	let browserGone = false

	const sendBrowser = (message) => {
		if (browser.readyState === WebSocket.OPEN) browser.send(JSON.stringify(message))
	}
	const isBrowserGone = () => browserGone || browser.readyState !== WebSocket.OPEN

	const closeStation = () => {
		if (station && station.readyState < WebSocket.CLOSING) station.close(1000, 'Browser disconnected')
		station = null
	}
	const onBrowserGone = () => {
		browserGone = true
		closeStation()
	}

	async function connect(message) {
		if (connecting) {
			sendBrowser({ op: 'error', id: message.id, code: 'connect_in_progress', message: 'A station connection is already in progress.' })
			return
		}
		connecting = true
		closeStation()
		let next = null
		try {
			const base = stationBaseUrl(message.stationUrl)
			const tlsMode = message.tlsMode === 'insecure' ? 'insecure' : 'strict'
			if (tlsMode === 'insecure') {
				// Certificate verification is off: anyone on the network path can impersonate
				// the station (MITM) and receive the SCRAM exchange and session cookies.
				console.warn(`baskStream bridge: TLS certificate verification DISABLED for ${base.host}. Connection is vulnerable to man-in-the-middle attacks.`)
			}
			const cookies = new Map()
			const health = await login(base, text(message.username), text(message.password), cookies, tlsMode)
			if (isBrowserGone()) return
			next = await connectStation(base, cookies, tlsMode)
			if (isBrowserGone()) {
				next.close(1000, 'Browser disconnected')
				return
			}
			const socket = next
			station = socket
			socket.on('message', (frame, stationIsBinary) => {
				if (!stationIsBinary || station !== socket) return
				try {
					sendBrowser(decode(frame))
				} catch {
					sendBrowser({ op: 'error', code: 'station_decode_failed', message: 'Station sent malformed MessagePack.' })
					socket.close(1002, 'Malformed MessagePack')
				}
			})
			// Only the current connection may report to the browser; a replaced socket closes silently.
			socket.once('close', () => {
				if (station !== socket) return
				station = null
				sendBrowser({ op: 'station_closed' })
			})
			socket.on('error', (error) => {
				if (station === socket) sendBrowser({ op: 'error', code: 'station_ws_error', message: error.message })
			})
			sendBrowser({ op: 'station_connected', id: message.id, health })
		} catch (error) {
			if (next && next !== station && next.readyState < WebSocket.CLOSING) next.close(1000, 'Connection abandoned')
			sendBrowser({
				op: 'error',
				id: message.id,
				code: 'connect_failed',
				message: error instanceof Error ? error.message : String(error),
			})
		} finally {
			connecting = false
		}
	}

	async function handleMessage(payload, isBinary) {
		if (isBinary) {
			sendBrowser({ op: 'error', code: 'bad_request', message: 'Expected JSON text frames.' })
			return
		}

		let message
		try {
			message = JSON.parse(payload.toString('utf8'))
		} catch {
			sendBrowser({ op: 'error', code: 'bad_request', message: 'Invalid JSON frame.' })
			return
		}
		if (!isPlainObject(message)) {
			sendBrowser({ op: 'error', code: 'bad_request', message: 'Expected a JSON object frame.' })
			return
		}

		if (message.op === 'connect_station') {
			await connect(message)
			return
		}

		if (!station || station.readyState !== WebSocket.OPEN) {
			sendBrowser({ op: 'error', id: message.id, code: 'not_connected', message: 'Station WebSocket is not connected.' })
			return
		}
		const writeOperation = baskstreamWriteOperations.has(text(message.op))
		if (writeOperation) {
			try {
				if (message.confirmedWrite !== true) throw new Error('Station writes require confirmation in basdraw.')
				const { op, id, confirmedWrite: _confirmed, ...input } = message
				message = { ...validateBaskstreamInput(op, input), op, id }
			} catch (error) { sendBrowser({ op: 'error', id: message.id, code: 'invalid_write', message: error instanceof Error ? error.message : String(error) }); return }
		}
		if (!readOnlyOperations.has(text(message.op)) && !writeOperation) {
			sendBrowser({
				op: 'error',
				id: message.id,
				code: 'unsupported_operation',
				message: `Operation ${text(message.op) || '(missing)'} is not supported by the basdraw bridge.`,
			})
			return
		}

		try {
			station.send(encode(message), { binary: true })
		} catch (error) {
			sendBrowser({
				op: 'error',
				id: message.id,
				code: 'station_send_failed',
				message: error instanceof Error ? error.message : String(error),
			})
		}
	}

	browser.on('message', (payload, isBinary) => {
		handleMessage(payload, isBinary).catch((error) => {
			console.error('baskStream bridge: message handler failed:', error)
			sendBrowser({ op: 'error', code: 'bridge_error', message: error instanceof Error ? error.message : String(error) })
		})
	})

	browser.on('close', onBrowserGone)
	browser.on('error', onBrowserGone)
})

// Last resort: every handler above catches its own errors, but a stray rejection
// must not take down the bridge for every open canvas.
process.on('unhandledRejection', (error) => {
	console.error('baskStream bridge: unhandled rejection:', error)
})

server.listen(port, host, () => {
	console.log(`baskStream bridge: ws://${host}:${port}/baskstream`)
})

function stationBaseUrl(input) {
	const raw = text(input).trim()
	if (!raw) throw new Error('Station URL is required.')
	const withProtocol = /^[a-z]+:/i.test(raw) ? raw : `https://${raw}`
	const parsed = new URL(withProtocol)
	if (parsed.protocol === 'ws:') parsed.protocol = 'http:'
	if (parsed.protocol === 'wss:') parsed.protocol = 'https:'
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new Error('Station URL must use HTTP, HTTPS, WS, or WSS.')
	}
	if (parsed.username || parsed.password) throw new Error('Do not put credentials in the station URL.')
	return new URL(parsed.origin)
}

async function login(base, username, password, cookies, tlsMode) {
	if (!username || !password) throw new Error('Station user and password are required.')
	await stationRequest(base, cookies, tlsMode, 'GET', '/prelogin')
	const userStep = await stationRequest(
		base,
		cookies,
		tlsMode,
		'POST',
		'/login',
		`j_username=${encodeURIComponent(username)}`,
		{ 'Content-Type': 'application/x-www-form-urlencoded' }
	)
	if (userStep.status !== 200 || !userStep.body.includes('j_security_check')) {
		throw new Error(`Niagara username step failed with HTTP ${userStep.status}.`)
	}

	const nonce = crypto.randomBytes(18).toString('base64')
	const firstBare = `n=${prepareUsername(username)},r=${nonce}`
	const first = await stationRequest(
		base,
		cookies,
		tlsMode,
		'POST',
		'/j_security_check/',
		`action=sendClientFirstMessage&clientFirstMessage=n,,${firstBare}`,
		{ 'Content-Type': 'application/x-niagara-login-support' }
	)
	if (first.status !== 200) throw new Error(`Niagara SCRAM first step failed with HTTP ${first.status}.`)
	const challengeText = first.body.trim()
	const challenge = parseScram(challengeText)
	const iterations = Number(challenge.i)
	if (!challenge.r?.startsWith(nonce) || !challenge.s || !Number.isInteger(iterations) || iterations < 1 || iterations > maxScramIterations) {
		throw new Error('Niagara returned an invalid SCRAM challenge.')
	}

	const salted = await pbkdf2(
		Buffer.from(password.normalize('NFKC'), 'utf8'),
		Buffer.from(challenge.s, 'base64'),
		iterations,
		32,
		'sha256'
	)
	const finalWithoutProof = `c=biws,r=${challenge.r}`
	const authMessage = `${firstBare},${challengeText},${finalWithoutProof}`
	const clientKey = hmac(salted, 'Client Key')
	const proof = xor(clientKey, hmac(sha256(clientKey), authMessage)).toString('base64')
	const final = await stationRequest(
		base,
		cookies,
		tlsMode,
		'POST',
		'/j_security_check/',
		`action=sendClientFinalMessage&clientFinalMessage=${finalWithoutProof},p=${proof}`,
		{ 'Content-Type': 'application/x-niagara-login-support' }
	)
	if (final.status !== 200) throw new Error(`Niagara SCRAM final step failed with HTTP ${final.status}.`)
	const serverFinal = parseScram(final.body.trim())
	if (serverFinal.e) throw new Error(`Niagara authentication failed: ${serverFinal.e}.`)
	const expectedSignature = hmac(hmac(salted, 'Server Key'), authMessage)
	if (!serverFinal.v || !matchesBase64(serverFinal.v, expectedSignature)) {
		throw new Error('Niagara SCRAM server signature verification failed.')
	}

	await stationRequest(base, cookies, tlsMode, 'GET', '/j_security_check/')
	const health = await stationRequest(base, cookies, tlsMode, 'GET', '/stream/health')
	if (health.status === 401 || health.status === 403) throw new Error('Niagara login did not authorize /stream/health.')
	if (health.status !== 200) throw new Error(`baskStream health check failed with HTTP ${health.status}.`)
	try {
		return JSON.parse(health.body)
	} catch {
		throw new Error('baskStream health returned invalid JSON.')
	}
}

function stationRequest(base, cookies, tlsMode, method, pathname, body = '', headers = {}) {
	return new Promise((resolve, reject) => {
		const secure = base.protocol === 'https:'
		const request = (secure ? https : http).request(
			{
				hostname: base.hostname,
				port: base.port || (secure ? 443 : 80),
				method,
				path: pathname,
				rejectUnauthorized: tlsMode !== 'insecure',
				timeout: 15_000,
				headers: {
					Host: base.host,
					Cookie: cookieHeader(cookies),
					...headers,
					...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
				},
			},
			(response) => {
				response.on('error', reject)
				storeCookies(cookies, response.headers)
				const chunks = []
				let received = 0
				response.on('data', (chunk) => {
					received += chunk.length
					if (received > maxStationResponseBytes) {
						request.destroy(new Error('Station response exceeded the 8 MB safety limit.'))
						return
					}
					chunks.push(chunk)
				})
				response.on('end', () => resolve({
					status: response.statusCode || 0,
					body: Buffer.concat(chunks).toString('utf8'),
				}))
			}
		)
		request.on('error', reject)
		request.on('timeout', () => request.destroy(new Error('Station request timed out.')))
		if (body) request.write(body)
		request.end()
	})
}

function connectStation(base, cookies, tlsMode) {
	const protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
	const url = `${protocol}//${base.host}/stream`
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(url, {
			headers: { Cookie: cookieHeader(cookies), Origin: base.origin },
			rejectUnauthorized: tlsMode !== 'insecure',
			handshakeTimeout: 15_000,
			maxPayload: 32 * 1024 * 1024,
		})
		const fail = (error) => reject(error instanceof Error ? error : new Error(String(error)))
		socket.once('error', fail)
		socket.once('open', () => {
			socket.off('error', fail)
			resolve(socket)
		})
	})
}

function parseScram(value) {
	return Object.fromEntries(value.split(',').map((part) => {
		const index = part.indexOf('=')
		return [part.slice(0, index), part.slice(index + 1)]
	}))
}

function prepareUsername(value) {
	return value.normalize('NFKC').replace(/=/g, '=3D').replace(/,/g, '=2C')
}

function hmac(key, value) {
	return crypto.createHmac('sha256', key).update(value, 'utf8').digest()
}

function sha256(value) {
	return crypto.createHash('sha256').update(value).digest()
}

function xor(a, b) {
	return Buffer.from(a.map((value, index) => value ^ b[index]))
}

function pbkdf2(password, salt, iterations, keyLength, digest) {
	return new Promise((resolve, reject) => {
		crypto.pbkdf2(password, salt, iterations, keyLength, digest, (error, derived) => error ? reject(error) : resolve(derived))
	})
}

function matchesBase64(value, expected) {
	const actual = Buffer.from(value, 'base64')
	return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

function cookieHeader(cookies) {
	return [...cookies].map(([key, value]) => `${key}=${value}`).join('; ')
}

function storeCookies(cookies, headers) {
	for (const raw of headers['set-cookie'] || []) {
		const pair = raw.split(';')[0]
		const index = pair.indexOf('=')
		if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1))
	}
}

function isPlainObject(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value) {
	return typeof value === 'string' ? value : ''
}
