import type { CreateKnowledgeEntryInput, UpdateKnowledgeEntryInput } from './schemas'
import type { KnowledgeContextScope, KnowledgeEntry, KnowledgeEntrySummary, KnowledgeKind, KnowledgeScopeType } from './types'

const LIST_PAGE_SIZE = 50
const LIST_PAGE_SIZE_MAX = 100
/**
 * D1 allows 100 bound parameters per statement. Plugin and connection id lists
 * travel as a single JSON parameter (json_each), so statements stay under ~15
 * parameters regardless of list length; the lists are still capped.
 * basdraw ships ~40 built-in plugins, so the cap leaves headroom.
 */
export const MAX_SCOPE_IDS = 100

type KnowledgeRow = {
	id: string
	kind: KnowledgeKind
	title: string
	description: string
	content: string
	scope_type: KnowledgeScopeType
	scope_id: string | null
	enabled: number
	priority: number
	source: string
	plugin_id: string | null
	tags_json: string
	created_at: number
	updated_at: number
}

export class KnowledgeStore {
	private readonly database: D1Database
	constructor(database: D1Database) { this.database = database }

	/** Metadata only: entry bodies never enter the initial agent catalog. */
	async catalog(scope: KnowledgeContextScope, offset = 0) {
		const { sql, values } = scopeFilter(scope)
		const result = await this.database.prepare(`
			SELECT id, kind, title, description, '' AS content, scope_type, scope_id,
			 enabled, priority, source, plugin_id, tags_json, created_at, updated_at
			FROM knowledge_entries WHERE ${sql}
			ORDER BY priority DESC, id LIMIT 41 OFFSET ?
		`).bind(...values, offset).all<KnowledgeRow>()
		return { entries: (result.results ?? []).slice(0, 40).map(toKnowledgeEntry), hasMore: (result.results ?? []).length > 40 }
	}

	async getScoped(id: string, scope: KnowledgeContextScope) {
		const { sql, values } = scopeFilter(scope)
		const row = await this.database.prepare(`SELECT * FROM knowledge_entries WHERE id = ? AND ${sql}`)
			.bind(id, ...values).first<KnowledgeRow>()
		return row ? toKnowledgeEntry(row) : null
	}

	async search(scope: KnowledgeContextScope, query: string, projectOnly = false) {
		if (projectOnly && !scope.projectId) return []
		const { sql, values } = scopeFilter(scope)
		const terms = [...new Set(query.toLowerCase().trim().split(/\s+/))].filter(Boolean).slice(0, 8)
		if (!terms.length) return []
		const match = terms.map(() => "instr(lower(title || ' ' || description || ' ' || content || ' ' || tags_json), ?) > 0").join(' AND ')
		const result = await this.database.prepare(`SELECT * FROM knowledge_entries WHERE ${sql}
			${projectOnly ? "AND scope_type = 'project' AND scope_id = ?" : ''}
			AND (${match}) ORDER BY priority DESC, updated_at DESC, id LIMIT 21`)
			.bind(...values, ...(projectOnly ? [scope.projectId] : []), ...terms).all<KnowledgeRow>()
		return (result.results ?? []).map(toKnowledgeEntry)
	}

	/** Administrative metadata listing. Bodies are fetched per entry with `get`. */
	async list(filters: { kind?: KnowledgeKind; scopeType?: KnowledgeScopeType; scopeId?: string; enabled?: boolean; cursor?: string; limit?: number } = {}) {
		const conditions: string[] = []
		const values: unknown[] = []
		if (filters.kind) { conditions.push('kind = ?'); values.push(filters.kind) }
		if (filters.scopeType) { conditions.push('scope_type = ?'); values.push(filters.scopeType) }
		if (filters.scopeId) { conditions.push('scope_id = ?'); values.push(filters.scopeId) }
		if (typeof filters.enabled === 'boolean') { conditions.push('enabled = ?'); values.push(filters.enabled ? 1 : 0) }
		const after = filters.cursor ? decodeListCursor(filters.cursor) : null
		if (filters.cursor && !after) throw new Error('Invalid knowledge list cursor.')
		if (after) {
			conditions.push('(priority < ? OR (priority = ? AND updated_at < ?) OR (priority = ? AND updated_at = ? AND id > ?))')
			values.push(after.priority, after.priority, after.updatedAt, after.priority, after.updatedAt, after.id)
		}
		const limit = Math.min(Math.max(Math.trunc(filters.limit ?? LIST_PAGE_SIZE), 1), LIST_PAGE_SIZE_MAX)
		const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
		const result = await this.database.prepare(`
			SELECT id, kind, title, description, '' AS content, length(content) AS content_length, scope_type, scope_id,
			 enabled, priority, source, plugin_id, tags_json, created_at, updated_at
			FROM knowledge_entries ${where}
			ORDER BY priority DESC, updated_at DESC, id
			LIMIT ?
		`).bind(...values, limit + 1).all<KnowledgeRow & { content_length: number }>()
		const rows = result.results ?? []
		const entries: KnowledgeEntrySummary[] = rows.slice(0, limit).map((row) => {
			const { content: _content, ...entry } = toKnowledgeEntry(row)
			return { ...entry, contentLength: row.content_length }
		})
		const last = rows.length > limit ? rows[limit - 1] : null
		return { entries, nextCursor: last ? encodeListCursor({ priority: last.priority, updatedAt: last.updated_at, id: last.id }) : null }
	}

	async get(id: string) {
		const row = await this.database.prepare('SELECT * FROM knowledge_entries WHERE id = ?').bind(id).first<KnowledgeRow>()
		return row ? toKnowledgeEntry(row) : null
	}

	async create(input: CreateKnowledgeEntryInput) {
		const now = Date.now()
		const id = input.id ?? crypto.randomUUID()
		const scopeId = input.scopeType === 'global' ? null : input.scopeId ?? null
		await this.database.prepare(`
			INSERT INTO knowledge_entries (
				id, kind, title, description, content, scope_type, scope_id, enabled,
				priority, source, plugin_id, tags_json, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).bind(
			id, input.kind, input.title, input.description, input.content, input.scopeType, scopeId,
			input.enabled ? 1 : 0, input.priority, input.source, input.pluginId ?? null,
			JSON.stringify(uniqueTags(input.tags)), now, now
		).run()
		return (await this.get(id))!
	}

	async update(id: string, patch: UpdateKnowledgeEntryInput) {
		const current = await this.get(id)
		if (!current) return null
		if ((patch.kind ?? current.kind) === 'skill' && (patch.content ?? current.content).length > 12_000 && (patch.content !== undefined || patch.kind !== undefined)) {
			throw new Error('Keep skills under 12,000 characters. Store longer supporting material as references.')
		}
		const scopeType = patch.scopeType ?? current.scopeType
		const requestedScopeId = patch.scopeId === undefined ? current.scopeId : patch.scopeId
		const scopeId = scopeType === 'global' ? null : requestedScopeId
		if (!scopeId && scopeType !== 'global') throw new Error(`${scopeType} entries require a scope id.`)
		await this.database.prepare(`
			UPDATE knowledge_entries SET
				kind = ?, title = ?, description = ?, content = ?, scope_type = ?, scope_id = ?,
				enabled = ?, priority = ?, source = ?, plugin_id = ?, tags_json = ?, updated_at = ?
			WHERE id = ?
		`).bind(
			patch.kind ?? current.kind,
			patch.title ?? current.title,
			patch.description ?? current.description,
			patch.content ?? current.content,
			scopeType,
			scopeId,
			(patch.enabled ?? current.enabled) ? 1 : 0,
			patch.priority ?? current.priority,
			patch.source ?? current.source,
			patch.pluginId === undefined ? current.pluginId : patch.pluginId,
			JSON.stringify(uniqueTags(patch.tags ?? current.tags)),
			Date.now(),
			id,
		).run()
		return this.get(id)
	}

	async remove(id: string) {
		const result = await this.database.prepare('DELETE FROM knowledge_entries WHERE id = ?').bind(id).run()
		return (result.meta.changes ?? 0) > 0
	}

}

/** Apply the same scope filter to catalog, search AND direct ID reads. */
function scopeFilter(scope: KnowledgeContextScope) {
	const values: unknown[] = []
	const clauses = ["scope_type = 'global'"]
	if (scope.projectId) { clauses.push("(scope_type = 'project' AND scope_id = ?)"); values.push(scope.projectId) }
	const connections = [...new Set([scope.connectionId, ...(scope.connectionIds ?? [])])].filter((id): id is string => Boolean(id)).slice(0, MAX_SCOPE_IDS + 1)
	if (connections.length) {
		clauses.push("(scope_type = 'connection' AND scope_id IN (SELECT value FROM json_each(?)))"); values.push(JSON.stringify(connections))
	}
	const plugins = [...new Set(scope.pluginIds ?? [])].slice(0, MAX_SCOPE_IDS)
	const pluginClause = plugins.length ? 'AND (plugin_id IS NULL OR plugin_id IN (SELECT value FROM json_each(?)))' : 'AND plugin_id IS NULL'
	if (plugins.length) values.push(JSON.stringify(plugins))
	return { sql: `enabled = 1 AND (${clauses.join(' OR ')}) ${pluginClause}`, values }
}

type ListCursor = { priority: number; updatedAt: number; id: string }

function encodeListCursor(cursor: ListCursor) {
	return btoa(JSON.stringify([cursor.priority, cursor.updatedAt, cursor.id])).replace(/=+$/, '')
}

function decodeListCursor(value: string): ListCursor | null {
	try {
		const parsed: unknown = JSON.parse(atob(value))
		if (!Array.isArray(parsed) || parsed.length !== 3) return null
		const [priority, updatedAt, id] = parsed
		return Number.isInteger(priority) && Number.isInteger(updatedAt) && typeof id === 'string' ? { priority, updatedAt, id } : null
	} catch { return null }
}

function toKnowledgeEntry(row: KnowledgeRow): KnowledgeEntry {
	return {
		id: row.id,
		kind: row.kind,
		title: row.title,
		description: row.description,
		content: row.content,
		scopeType: row.scope_type,
		scopeId: row.scope_id,
		enabled: row.enabled === 1,
		priority: row.priority,
		source: row.source,
		pluginId: row.plugin_id,
		tags: parseTags(row.tags_json),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	}
}

function parseTags(value: string) {
	try {
		const parsed: unknown = JSON.parse(value)
		return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : []
	} catch { return [] }
}

function uniqueTags(tags: string[]) {
	return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))]
}
