import { ExecutionContext } from '@cloudflare/workers-types'
import { WorkerEntrypoint } from 'cloudflare:workers'
import { AutoRouter, cors, error, IRequest } from 'itty-router'
import { Environment } from './environment'
import { stream } from './routes/stream'

const { preflight, corsify } = cors({ origin: '*' })

const router = AutoRouter<IRequest, [env: Environment, ctx: ExecutionContext]>({
	before: [preflight],
	finally: [corsify],
	catch: (e) => {
		console.error(e)
		return error(e)
	},
})
	.get('/agent/status', (_request, env) => Response.json({
		configured: Boolean(env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY || env.GOOGLE_API_KEY),
		providers: {
			openai: Boolean(env.OPENAI_API_KEY),
			anthropic: Boolean(env.ANTHROPIC_API_KEY),
			google: Boolean(env.GOOGLE_API_KEY),
		},
	}))
	.post('/stream', stream)

export default class extends WorkerEntrypoint<Environment> {
	override fetch(request: Request): Promise<Response> {
		return router.fetch(request, this.env, this.ctx)
	}
}

// Make the durable object available to the cloudflare worker
export { AgentDurableObject } from './do/AgentDurableObject'
