CREATE TABLE IF NOT EXISTS connection_audit (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL,
 connection_id TEXT NOT NULL,
 connection_label TEXT NOT NULL,
 tool_id TEXT NOT NULL,
 arguments_json TEXT NOT NULL,
 result_json TEXT,
 state TEXT NOT NULL CHECK (state IN ('approved', 'completed', 'failed')),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS connection_audit_project ON connection_audit(project_id, created_at DESC);
