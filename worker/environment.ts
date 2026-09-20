export interface Environment {
	AGENT_DURABLE_OBJECT: DurableObjectNamespace
	KNOWLEDGE_DB: D1Database
	KNOWLEDGE_ADMIN_TOKEN?: string
	OPENAI_API_KEY?: string
	ANTHROPIC_API_KEY?: string
	GOOGLE_API_KEY?: string
	CODEX_BRIDGE_URL?: string
}
