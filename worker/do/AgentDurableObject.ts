import { DurableObject } from 'cloudflare:workers'
import { AutoRouter, error } from 'itty-router'
import { AgentAction } from '../../shared/types/AgentAction'
import { AgentPrompt } from '../../shared/types/AgentPrompt'
import { Streaming } from '../../shared/types/Streaming'
import { Environment } from '../environment'
import { AgentService } from './AgentService'

export class AgentDurableObject extends DurableObject<Environment> {
	service: AgentService

	constructor(ctx: DurableObjectState, env: Environment) {
		super(ctx, env)
		this.service = new AgentService(this.env) // swap this with your own service
	}

	private readonly router = AutoRouter({
		catch: (e) => {
			console.error(e)
			return error(e)
		},
	}).post('/stream', (request) => this.stream(request))

	// `fetch` is the entry point for all requests to the Durable Object
	override fetch(request: Request): Response | Promise<Response> {
		return this.router.fetch(request)
	}

	/**
	 * Stream changes from the model.
	 *
	 * @param request - The request object containing the prompt.
	 * @returns A Promise that resolves to a Response object containing the streamed changes.
	 */
	private async stream(request: Request): Promise<Response> {
		let prompt: AgentPrompt
		try {
			prompt = (await request.json()) as AgentPrompt
		} catch {
			return Response.json({ error: 'The agent request body must be JSON.' }, { status: 400 })
		}
		if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)) {
			return Response.json({ error: 'The agent request body must be a prompt object.' }, { status: 400 })
		}

		const encoder = new TextEncoder()
		const { readable, writable } = new TransformStream()
		const writer = writable.getWriter()
		// Aborted when the client disconnects (request.signal) or the response stream is cancelled.
		const controller = new AbortController()
		const abort = () => controller.abort()
		if (request.signal.aborted) abort()
		else request.signal.addEventListener('abort', abort, { once: true })

		const response: { changes: Streaming<AgentAction>[] } = { changes: [] }

		;(async () => {
			try {
				for await (const change of this.service.stream(prompt, controller.signal)) {
					if (controller.signal.aborted) break
					response.changes.push(change)
					const data = `data: ${JSON.stringify(change)}\n\n`
					await writer.write(encoder.encode(data))
					await writer.ready
				}
				await writer.close()
			} catch (error: any) {
				if (controller.signal.aborted) {
					await writer.abort(error).catch(() => {})
					return
				}
				console.error('Stream error:', error)

				// Send error through the stream
				const errorData = `data: ${JSON.stringify({ error: error.message })}\n\n`
				try {
					await writer.write(encoder.encode(errorData))
					await writer.close()
				} catch (writeError) {
					abort()
					await writer.abort(writeError).catch(() => {})
				}
			} finally {
				request.signal.removeEventListener('abort', abort)
			}
		})()

		// If the reader goes away, stop generating instead of writing into a dead stream.
		writer.closed.catch(abort)

		return new Response(readable, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache, no-transform',
				Connection: 'keep-alive',
				'X-Accel-Buffering': 'no',
				'Transfer-Encoding': 'chunked',
			},
		})
	}
}
