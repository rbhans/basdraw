import { IRequest } from 'itty-router'
import { Environment } from '../environment'

export async function stream(request: IRequest, env: Environment) {
	// eventually... use some kind of per-user id, so that each user has their own worker
	const id = env.AGENT_DURABLE_OBJECT.idFromName('anonymous')
	const DO = env.AGENT_DURABLE_OBJECT.get(id)
	// Forward the client's abort so a closed tab or Stop cancels the model/bridge request.
	const response = await DO.fetch(request.url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: request.body as any,
		signal: request.signal,
	})

	if (!response.ok) {
		return new Response(response.body as BodyInit, {
			status: response.status,
			headers: {
				'Content-Type': response.headers.get('Content-Type') || 'text/plain; charset=utf-8',
				'Cache-Control': 'no-store',
			},
		})
	}

	return new Response(response.body as BodyInit, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no',
			'Transfer-Encoding': 'chunked',
		},
	})
}
