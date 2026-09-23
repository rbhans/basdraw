-- Write outcomes: a write whose result is indeterminate is recorded as 'unknown'.
-- 'completed' rows from 0003 become 'succeeded' (the API still accepts 'completed').
-- SQLite cannot alter a CHECK constraint, so the table is rebuilt.
CREATE TABLE connection_audit_next (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL,
 connection_id TEXT NOT NULL,
 connection_label TEXT NOT NULL,
 tool_id TEXT NOT NULL,
 arguments_json TEXT NOT NULL,
 arguments_sha256 TEXT,
 session_id TEXT,
 station_alias TEXT,
 station_endpoint TEXT,
 result_json TEXT,
 state TEXT NOT NULL CHECK (state IN ('approved', 'succeeded', 'failed', 'unknown', 'cancelled')),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
INSERT INTO connection_audit_next (id, project_id, connection_id, connection_label, tool_id, arguments_json, result_json, state, created_at, updated_at)
 SELECT id, project_id, connection_id, connection_label, tool_id, arguments_json, result_json,
  CASE state WHEN 'completed' THEN 'succeeded' ELSE state END, created_at, updated_at
 FROM connection_audit;
DROP TABLE connection_audit;
ALTER TABLE connection_audit_next RENAME TO connection_audit;
CREATE INDEX IF NOT EXISTS connection_audit_project ON connection_audit(project_id, created_at DESC);
