INSERT OR IGNORE INTO knowledge_entries (
	id, kind, title, description, content, scope_type, scope_id, enabled,
	priority, source, plugin_id, tags_json, created_at, updated_at
) VALUES (
	'basdraw:baskstream-connection',
	'skill',
	'baskStream connection workflow',
	'How basdraw should inspect a connected Niagara station through the baskStream plugin.',
	'Use the live capabilities response as the authority for available operations. Verify stream health and authenticate through the connection layer, then prefer shallow browse, bounded search, batched read requests, and one view-scoped replace_subscriptions group for active canvas points. Never place passwords, authenticated cookies, session tokens, or a copy of the station database in model context. The current local bridge is read-only. Any future station mutation must first inspect capability and permission metadata, preview the exact target and change, require explicit user confirmation, record the result, and verify the post-write value.',
	'global',
	NULL,
	1,
	100,
	'basdraw',
	'niagara-baskstream',
	'["niagara","baskstream","connection","safety"]',
	unixepoch() * 1000,
	unixepoch() * 1000
);
