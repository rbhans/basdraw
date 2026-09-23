import type { IRequest } from 'itty-router'
import { z } from 'zod'
import type { Environment } from '../environment'
import { authorizeRequest } from '../requestTrust'

/** Outcomes a write can finish with. `completed` is the legacy spelling of `succeeded`. */
export const connectionAuditOutcomes = ['succeeded', 'failed', 'unknown', 'cancelled'] as const
export const connectionAuditStates = ['approved', ...connectionAuditOutcomes] as const

const auditId = z.string().uuid()
const sha256 = z.string().regex(/^[0-9a-f]{64}$/)

export const connectionAuditRecordSchema = z.object({
	id: auditId,
	projectId: z.string().min(1).max(200),
	connectionId: z.string().min(1).max(200),
	connectionLabel: z.string().max(300),
	toolId: z.string().min(1).max(100),
	arguments: z.record(z.string(), z.json()),
	// Optional provenance: connection session, station identity and the hash the user approved.
	sessionId: z.string().min(1).max(200).optional(),
	stationAlias: z.string().min(1).max(200).optional(),
	stationEndpoint: z.string().min(1).max(500).optional(),
	argumentsHash: sha256.optional(),
}).strict()

export const connectionAuditResultSchema = z.object({
	state: z.enum([...connectionAuditOutcomes, 'completed']),
	result: z.json(),
}).strict()

export async function createConnectionAudit(request: IRequest, env: Environment) {
	const denied = authorizeRequest(request, env)
	if (denied) return denied
	const input = connectionAuditRecordSchema.safeParse(await readJson(request))
	if (!input.success) return json({ error: 'Invalid audit record.', issues: issues(input.error.issues) }, 400)
	const data = input.data, args = JSON.stringify(data.arguments)
	if (args.length > 500_000) return json({ error: 'Change is too large.' }, 400)
	const argumentsHash = data.argumentsHash ?? await sha256Hex(args)
	const now = Date.now()
	try {
		await env.KNOWLEDGE_DB.prepare(`INSERT INTO connection_audit (id, project_id, connection_id, connection_label, tool_id, arguments_json,
			arguments_sha256, session_id, station_alias, station_endpoint, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
			.bind(data.id, data.projectId, data.connectionId, data.connectionLabel, data.toolId, args, argumentsHash,
				data.sessionId ?? null, data.stationAlias ?? null, data.stationEndpoint ?? null, 'approved', now, now).run()
	} catch (cause) {
		if (String(cause instanceof Error ? cause.message : cause).includes('UNIQUE constraint failed')) return json({ error: 'An audit record with that id already exists.' }, 409)
		throw cause
	}
	return json({ id: data.id, argumentsHash }, 201)
}

export async function finishConnectionAudit(request: IRequest, env: Environment) {
	const denied = authorizeRequest(request, env)
	if (denied) return denied
	const id = auditId.safeParse(request.params?.id)
	if (!id.success) return json({ error: 'Invalid audit id.' }, 400)
	const input = connectionAuditResultSchema.safeParse(await readJson(request))
	if (!input.success) return json({ error: 'Invalid audit result.', issues: issues(input.error.issues) }, 400)
	const result = JSON.stringify(input.data.result)
	if (result.length > 100_000) return json({ error: 'Result is too large.' }, 400)
	const state = input.data.state === 'completed' ? 'succeeded' : input.data.state
	const updated = await env.KNOWLEDGE_DB.prepare('UPDATE connection_audit SET state = ?, result_json = ?, updated_at = ? WHERE id = ? AND state = ?')
		.bind(state, result, Date.now(), id.data, 'approved').run()
	if ((updated.meta.changes ?? 0) > 0) return json({ ok: true, state })
	const existing = await env.KNOWLEDGE_DB.prepare('SELECT state FROM connection_audit WHERE id = ?').bind(id.data).first<{ state: string }>()
	return existing
		? json({ error: `Audit record already finished as ${existing.state}.`, state: existing.state }, 409)
		: json({ error: 'Audit record not found.' }, 404)
}

async function readJson(request: Request) {
	try { return await request.json() }
	catch { return undefined }
}

async function sha256Hex(value: string) {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function issues(list: { path: PropertyKey[]; message: string }[]) {
	return list.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message }))
}

function json(value: unknown, status = 200) {
	return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } })
}
