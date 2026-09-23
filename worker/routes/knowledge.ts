import type { IRequest } from 'itty-router'
import { createKnowledgeEntrySchema, updateKnowledgeEntrySchema } from '../knowledge/schemas'
import { KnowledgeStore, MAX_SCOPE_IDS } from '../knowledge/KnowledgeStore'
import type { Environment } from '../environment'
import type { KnowledgeKind, KnowledgeScopeType } from '../knowledge/types'
import { z } from 'zod'
import { KnowledgeAction } from '../../shared/schema/AgentActionSchemas'
import { knowledgeBundles } from '../../shared/knowledge/bundles'
import { KnowledgeService } from '../knowledge/KnowledgeService'
import { authorizeRequest } from '../requestTrust'

const retrievalSchema = z.object({
	scope: z.object({
		projectId: z.string().max(200).nullable(),
		connectionId: z.string().max(200).nullable(),
		pluginIds: z.array(z.string().max(120)).max(MAX_SCOPE_IDS),
		connectionIds: z.array(z.string().max(200)).max(MAX_SCOPE_IDS).optional(),
		connectionTypes: z.array(z.string().max(120)).max(MAX_SCOPE_IDS).optional(),
	}),
	request: KnowledgeAction,
})

export async function retrieveKnowledge(request: IRequest, env: Environment) {
	const denied = authorizeKnowledgeAdmin(request, env)
	if (denied) return denied
	const parsed = retrievalSchema.safeParse(await readJson(request))
	if (!parsed.success) return validationError(parsed.error.issues)
	try {
		const service = new KnowledgeService(new KnowledgeStore(env.KNOWLEDGE_DB), knowledgeBundles)
		return json(await service.retrieve(parsed.data.scope, parsed.data.request))
	} catch (cause) {
		return json({ error: cause instanceof Error ? cause.message : 'Knowledge retrieval unavailable.' }, 400)
	}
}

export async function listKnowledge(request: IRequest, env: Environment) {
	const denied = authorizeKnowledgeAdmin(request, env)
	if (denied) return denied
	const url = new URL(request.url)
	const enabled = optionalBoolean(url.searchParams.get('enabled'))
	const kind = optionalEnum(url.searchParams.get('kind'), ['skill', 'reference'] as const)
	const scopeType = optionalEnum(url.searchParams.get('scopeType'), ['global', 'project', 'connection'] as const)
	if (enabled instanceof Response || kind instanceof Response || scopeType instanceof Response) {
		return enabled instanceof Response ? enabled : kind instanceof Response ? kind : scopeType
	}
	const limit = url.searchParams.get('limit')
	if (limit !== null && !/^\d{1,3}$/.test(limit)) return json({ error: 'limit must be a whole number up to 100.' }, 400)
	try {
		const page = await new KnowledgeStore(env.KNOWLEDGE_DB).list({
			enabled,
			kind: kind as KnowledgeKind | undefined,
			scopeType: scopeType as KnowledgeScopeType | undefined,
			scopeId: url.searchParams.get('scopeId') || undefined,
			cursor: url.searchParams.get('cursor') || undefined,
			limit: limit === null ? undefined : Number(limit),
		})
		return json(page)
	} catch (cause) {
		if (cause instanceof Error && cause.message.includes('cursor')) return json({ error: cause.message }, 400)
		throw cause
	}
}

export async function getKnowledge(request: IRequest, env: Environment) {
	const denied = authorizeKnowledgeAdmin(request, env)
	if (denied) return denied
	const entry = await new KnowledgeStore(env.KNOWLEDGE_DB).get(request.params.id)
	return entry ? json({ entry }) : json({ error: 'Knowledge entry not found.' }, 404)
}

export async function previewKnowledgeContext(request: IRequest, env: Environment) {
	const denied = authorizeKnowledgeAdmin(request, env)
	if (denied) return denied
	const url = new URL(request.url)
	const catalog = await new KnowledgeService(new KnowledgeStore(env.KNOWLEDGE_DB), knowledgeBundles).catalog({
		projectId: url.searchParams.get('projectId'),
		connectionId: url.searchParams.get('connectionId'),
		pluginIds: listParam(url, 'pluginIds'),
		connectionIds: listParam(url, 'connectionIds'),
		connectionTypes: listParam(url, 'connectionTypes'),
	})
	return json(catalog)
}

export async function createKnowledge(request: IRequest, env: Environment) {
	const denied = authorizeKnowledgeAdmin(request, env)
	if (denied) return denied
	const parsed = createKnowledgeEntrySchema.safeParse(await readJson(request))
	if (!parsed.success) return validationError(parsed.error.issues)
	try {
		const entry = await new KnowledgeStore(env.KNOWLEDGE_DB).create(parsed.data)
		return json({ entry }, 201)
	} catch (error) {
		return databaseError(error)
	}
}

export async function updateKnowledge(request: IRequest, env: Environment) {
	const denied = authorizeKnowledgeAdmin(request, env)
	if (denied) return denied
	const parsed = updateKnowledgeEntrySchema.safeParse(await readJson(request))
	if (!parsed.success) return validationError(parsed.error.issues)
	if (Object.keys(parsed.data).length === 0) return json({ error: 'Provide at least one field to update.' }, 400)
	try {
		const entry = await new KnowledgeStore(env.KNOWLEDGE_DB).update(request.params.id, parsed.data)
		return entry ? json({ entry }) : json({ error: 'Knowledge entry not found.' }, 404)
	} catch (error) {
		return databaseError(error)
	}
}

export async function deleteKnowledge(request: IRequest, env: Environment) {
	const denied = authorizeKnowledgeAdmin(request, env)
	if (denied) return denied
	const removed = await new KnowledgeStore(env.KNOWLEDGE_DB).remove(request.params.id)
	return removed ? new Response(null, { status: 204 }) : json({ error: 'Knowledge entry not found.' }, 404)
}

/** Kept for existing callers; the policy is shared with /stream, /agent/* and the audit routes. */
export function authorizeKnowledgeAdmin(request: Request, env: Environment) {
	return authorizeRequest(request, env)
}

function listParam(url: URL, name: string) {
	return (url.searchParams.get(name) ?? '').split(',').map((id) => id.trim()).filter(Boolean).slice(0, MAX_SCOPE_IDS)
}

async function readJson(request: Request) {
	try { return await request.json() }
	catch { return null }
}

function validationError(issues: { path: PropertyKey[]; message: string }[]) {
	return json({
		error: 'Invalid knowledge entry.',
		issues: issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
	}, 400)
}

function databaseError(error: unknown) {
	const message = error instanceof Error ? error.message : String(error)
	if (message.includes('UNIQUE constraint failed')) return json({ error: 'A knowledge entry with that id already exists.' }, 409)
	if (message.includes('require a scope id')) return json({ error: message }, 400)
	if (message.includes('Keep skills under')) return json({ error: message }, 400)
	throw error
}

function optionalBoolean(value: string | null): boolean | undefined | Response {
	if (value === null) return undefined
	if (value === 'true' || value === '1') return true
	if (value === 'false' || value === '0') return false
	return json({ error: 'enabled must be true or false.' }, 400)
}

function optionalEnum<const T extends readonly string[]>(value: string | null, values: T): T[number] | undefined | Response {
	if (value === null) return undefined
	return values.includes(value) ? value as T[number] : json({ error: `Expected one of: ${values.join(', ')}.` }, 400)
}

function json(value: unknown, status = 200, headers: Record<string, string> = {}) {
	return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', ...headers } })
}
