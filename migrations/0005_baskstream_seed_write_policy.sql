-- 0002 seeded "The current local bridge is read-only." Station writes now exist behind
-- per-write approval, so correct the legacy seed text. The plugin bundle supersedes
-- this row at runtime; this keeps the stored copy truthful.
UPDATE knowledge_entries SET
 content = 'Use the live capabilities response as the authority for available operations. Verify stream health and authenticate through the connection layer, then prefer shallow browse, bounded search, batched read requests, and one view-scoped replace_subscriptions group for active canvas points. Never place passwords, authenticated cookies, session tokens, or a copy of the station database in model context. Station writes are available only when the user enables connection writes; every write must first inspect capability and permission metadata, preview the exact target and change, receive explicit per-write user approval, be recorded in the connection audit log, and have its post-write value verified. Treat an indeterminate write result as unknown and inspect the station before retrying.',
 updated_at = unixepoch() * 1000
WHERE id = 'basdraw:baskstream-connection' AND source = 'basdraw' AND instr(content, 'The current local bridge is read-only.') > 0;
