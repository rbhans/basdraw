import { ExecutionContext } from '@cloudflare/workers-types'
import { WorkerEntrypoint } from 'cloudflare:workers'
import { AutoRouter, error, IRequest } from 'itty-router'
import { Environment } from './environment'
import { stream } from './routes/stream'
import { createKnowledge, deleteKnowledge, getKnowledge, listKnowledge, previewKnowledgeContext, updateKnowledge, retrieveKnowledge } from './routes/knowledge'
import { getAgentStatus, startChatGptLogin } from './routes/agent'
import { createConnectionAudit, finishConnectionAudit } from './routes/connectionAudit'
import { guardRequest } from './requestTrust'

// No CORS: the app is served same-origin. Every privileged route shares one trust check.

const router = AutoRouter<IRequest, [env: Environment, ctx: ExecutionContext]>({
	before: [(request, env) => guardRequest(request, env)],
	catch: (e) => {
		console.error(e)
		return error(e)
	},
})
	.get('/agent/status', getAgentStatus)
	.post('/agent/login', startChatGptLogin)
	.post('/api/connection-audit', createConnectionAudit)
	.patch('/api/connection-audit/:id', finishConnectionAudit)
	.get('/api/knowledge', listKnowledge)
	.get('/api/knowledge/context', previewKnowledgeContext)
	.post('/api/knowledge/retrieve', retrieveKnowledge)
	.get('/api/knowledge/:id', getKnowledge)
	.post('/api/knowledge', createKnowledge)
	.patch('/api/knowledge/:id', updateKnowledge)
	.delete('/api/knowledge/:id', deleteKnowledge)
	.post('/stream', stream)

export default class extends WorkerEntrypoint<Environment> {
	override fetch(request: Request): Promise<Response> {
		return router.fetch(request, this.env, this.ctx)
	}
}

// Make the durable object available to the cloudflare worker
export { AgentDurableObject } from './do/AgentDurableObject'
