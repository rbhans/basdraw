CREATE TABLE IF NOT EXISTS knowledge_entries (
	id TEXT PRIMARY KEY,
	kind TEXT NOT NULL CHECK (kind IN ('skill', 'reference')),
	title TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	content TEXT NOT NULL,
	scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'project', 'connection')),
	scope_id TEXT,
	enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
	priority INTEGER NOT NULL DEFAULT 0,
	source TEXT NOT NULL DEFAULT 'user',
	plugin_id TEXT,
	tags_json TEXT NOT NULL DEFAULT '[]',
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	CHECK (
		(scope_type = 'global' AND scope_id IS NULL) OR
		(scope_type IN ('project', 'connection') AND scope_id IS NOT NULL AND length(scope_id) > 0)
	)
);

CREATE INDEX IF NOT EXISTS knowledge_entries_context
	ON knowledge_entries (enabled, scope_type, scope_id, priority DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS knowledge_entries_kind
	ON knowledge_entries (kind, enabled, updated_at DESC);
