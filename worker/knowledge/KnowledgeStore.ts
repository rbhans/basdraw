import type { CreateKnowledgeEntryInput, UpdateKnowledgeEntryInput } from './schemas'
import type { KnowledgeContextScope, KnowledgeEntry, KnowledgeKind, KnowledgeScopeType } from './types'

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

	async list(filters: { kind?: KnowledgeKind; scopeType?: KnowledgeScopeType; scopeId?: string; enabled?: boolean } = {}) {
		const conditions: string[] = []
		const values: unknown[] = []
		if (filters.kind) { conditions.push('kind = ?'); values.push(filters.kind) }
		if (filters.scopeType) { conditions.push('scope_type = ?'); values.push(filters.scopeType) }
		if (filters.scopeId) { conditions.push('scope_id = ?'); values.push(filters.scopeId) }
		if (typeof filters.enabled === 'boolean') { conditions.push('enabled = ?'); values.push(filters.enabled ? 1 : 0) }
		const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
		const result = await this.database.prepare(`
			SELECT * FROM knowledge_entries ${where}
			ORDER BY priority DESC, updated_at DESC
			LIMIT 500
		`).bind(...values).all<KnowledgeRow>()
		return (result.results ?? []).map(toKnowledgeEntry)
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
	for (const id of [...new Set([scope.connectionId, ...(scope.connectionIds ?? [])])].filter(Boolean)) {
		clauses.push("(scope_type = 'connection' AND scope_id = ?)"); values.push(id)
	}
	const plugins = [...new Set(scope.pluginIds ?? [])]
	const pluginClause = plugins.length ? `AND (plugin_id IS NULL OR plugin_id IN (${plugins.map(() => '?').join(',')}))` : 'AND plugin_id IS NULL'
	values.push(...plugins)
	return { sql: `enabled = 1 AND (${clauses.join(' OR ')}) ${pluginClause}`, values }
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
