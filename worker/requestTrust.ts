import type { Environment } from './environment'

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** Routes that can drive a model, read project knowledge or record station changes. */
export function isProtectedPath(pathname: string) {
	return pathname === '/stream' || pathname.startsWith('/agent/') || pathname === '/api' || pathname.startsWith('/api/')
}

/**
 * Single request-trust policy for every privileged route.
 *
 * Local development (the Vite dev server serves the app and Worker from the same
 * loopback origin): accept same-origin browser requests and non-browser local
 * tools. Reject any browser request that declares a different origin or a
 * cross-site fetch context. The Host must be loopback, so DNS-rebinding hosts
 * fall through to the deployed policy.
 *
 * Deployed: require `Authorization: Bearer <BASDRAW_API_TOKEN | KNOWLEDGE_ADMIN_TOKEN>`.
 * There is no CORS policy; cross-origin browsers cannot attach the header.
 */
export function authorizeRequest(request: Request, env: Pick<Environment, 'KNOWLEDGE_ADMIN_TOKEN' | 'BASDRAW_API_TOKEN'>): Response | null {
	const requestUrl = new URL(request.url)
	const origin = request.headers.get('Origin')
	const fetchSite = request.headers.get('Sec-Fetch-Site')
	const crossSite = (origin !== null && origin !== requestUrl.origin) || (fetchSite !== null && fetchSite !== 'same-origin' && fetchSite !== 'none')
	if (loopbackHosts.has(requestUrl.hostname)) {
		return crossSite ? json({ error: 'Cross-origin requests to basdraw are not allowed.' }, 403) : null
	}
	if (crossSite) return json({ error: 'Cross-origin requests to basdraw are not allowed.' }, 403)
	const token = env.BASDRAW_API_TOKEN || env.KNOWLEDGE_ADMIN_TOKEN
	if (!token) return json({ error: 'basdraw API access is not configured for this host.' }, 503)
	const authorization = request.headers.get('Authorization') ?? ''
	return constantTimeEqual(authorization, `Bearer ${token}`)
		? null
		: json({ error: 'Unauthorized.' }, 401, { 'WWW-Authenticate': 'Bearer' })
}

/** Bodies are parsed as JSON only when declared as JSON; simple cross-site forms cannot send it without a preflight. */
export function requireJsonBody(request: Request): Response | null {
	const type = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase()
	return type === 'application/json' ? null : json({ error: 'Expected Content-Type: application/json.' }, 415)
}

/** Router middleware: trust check for protected paths plus JSON content type for body-carrying methods. */
export function guardRequest(request: Request, env: Pick<Environment, 'KNOWLEDGE_ADMIN_TOKEN' | 'BASDRAW_API_TOKEN'>): Response | undefined {
	const { pathname } = new URL(request.url)
	if (!isProtectedPath(pathname)) return undefined
	if (request.method === 'OPTIONS') return json({ error: 'Cross-origin requests to basdraw are not allowed.' }, 403)
	const denied = authorizeRequest(request, env)
	if (denied) return denied
	// /agent/login carries no body; every other mutating route expects JSON.
	if ((request.method === 'POST' || request.method === 'PATCH' || request.method === 'PUT') && pathname !== '/agent/login') {
		return requireJsonBody(request) ?? undefined
	}
	return undefined
}

function constantTimeEqual(a: string, b: string) {
	const left = new TextEncoder().encode(a), right = new TextEncoder().encode(b)
	let difference = left.length ^ right.length
	for (let index = 0; index < Math.max(left.length, right.length); index++) difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
	return difference === 0
}

function json(value: unknown, status: number, headers: Record<string, string> = {}) {
	return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', ...headers } })
}
