// Shared request trust checks for the loopback helper servers (baskStream bridge,
// vector/document import, Codex subscription bridge).
//
// Binding to 127.0.0.1 is not enough on its own: a malicious page can use DNS
// rebinding (evil.example -> 127.0.0.1) to reach these ports from the browser.
// Every request must therefore carry a loopback Host header for the server's own
// port, and any Origin header must be one of the basdraw app's dev origins.
//
// BASDRAW_ALLOWED_ORIGINS: optional comma-separated list of exact origins that may
// call the local servers from a browser, e.g.
//   BASDRAW_ALLOWED_ORIGINS=http://127.0.0.1:5173,http://localhost:4173
// It replaces the default (the Vite dev server on port 5173).

export const defaultAllowedOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173']

const loopbackAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

export function allowedOrigins(env = process.env) {
	const configured = typeof env.BASDRAW_ALLOWED_ORIGINS === 'string' ? env.BASDRAW_ALLOWED_ORIGINS : ''
	const origins = configured.split(',').map((value) => normalizeOrigin(value.trim())).filter(Boolean)
	return origins.length ? origins : [...defaultAllowedOrigins]
}

export function isLoopbackAddress(address) {
	return loopbackAddresses.has(String(address ?? ''))
}

/** Host must name this server by a loopback literal and its exact port. */
export function isTrustedHost(host, port) {
	if (typeof host !== 'string' || !Number.isInteger(Number(port))) return false
	const value = host.trim().toLowerCase()
	return value === `127.0.0.1:${port}` || value === `localhost:${port}` || value === `[::1]:${port}`
}

export function isTrustedOrigin(origin, origins = allowedOrigins()) {
	const normalized = normalizeOrigin(origin)
	return Boolean(normalized) && origins.includes(normalized)
}

/**
 * Checks peer address, Host and Origin. `requireOrigin` is for endpoints only
 * browsers should reach (Origin is always sent on cross-origin fetch and WebSocket).
 * Without it, a missing Origin is allowed (server-side callers such as the Worker),
 * but a present Origin must still be allowlisted.
 */
export function isTrustedLocalRequest(request, { port, origins = allowedOrigins(), requireOrigin = false }) {
	return trustFailure(request, { port, origins, requireOrigin }) === null
}

/** Returns null when trusted, otherwise a short reason suitable for logs. */
export function trustFailure(request, { port, origins = allowedOrigins(), requireOrigin = false }) {
	const headers = request?.headers ?? {}
	if (!isLoopbackAddress(request?.socket?.remoteAddress)) return 'non-loopback peer'
	if (!isTrustedHost(headers.host, port)) return 'untrusted Host header'
	const origin = headers.origin
	if (origin === undefined || origin === '') return requireOrigin ? 'missing Origin header' : null
	return isTrustedOrigin(origin, origins) ? null : 'untrusted Origin header'
}

function normalizeOrigin(value) {
	if (typeof value !== 'string' || !value || value === 'null') return null
	try {
		const url = new URL(value)
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
		return url.origin
	} catch {
		return null
	}
}
