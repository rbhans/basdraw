import type { ConnectionInput } from './types'
import { ConnectionDispatchError } from '../../shared/connections.ts'

type Message = Record<string, unknown>
type PendingRequest = {
	resolve: (message: Message) => void
	reject: (error: Error) => void
	timer: number
}

export class BaskstreamClient {
	private socket: WebSocket | null = null
	private nextId = 0
	private pending = new Map<string, PendingRequest>()
	private listeners = new Set<(message: Message) => void>()

	async connect(input: ConnectionInput) {
		if (this.socket) this.close()
		const socket = new WebSocket('ws://127.0.0.1:8788/baskstream')
		this.socket = socket
		await new Promise<void>((resolve, reject) => {
			const timer = window.setTimeout(() => {
				socket.close()
				reject(new Error('The local baskStream bridge did not respond. Start the app with npm run dev.'))
			}, 5_000)
			socket.addEventListener('open', () => {
				window.clearTimeout(timer)
				resolve()
			}, { once: true })
			socket.addEventListener('error', () => {
				window.clearTimeout(timer)
				reject(new Error('The local baskStream bridge is unavailable on 127.0.0.1:8788.'))
			}, { once: true })
		})

		socket.addEventListener('message', (event) => this.onMessage(event.data))
		socket.addEventListener('close', () => this.onClosed())
		return this.request('connect_station', {
			stationUrl: input.stationUrl,
			username: input.username,
			password: input.password,
			tlsMode: input.tlsMode,
		}, 25_000)
	}

	request(op: string, fields: Message = {}, timeoutMs = 15_000) {
		// Errors say whether the request left this client: 'not-sent' is safe to retry,
		// 'unknown' (timeout or close after send) may already have been applied.
		const socket = this.socket
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			return Promise.reject(new ConnectionDispatchError('baskStream is not connected.', 'not-sent'))
		}
		const id = `bas-${++this.nextId}`
		let payload: string
		try {
			payload = JSON.stringify({ ...fields, op, id })
		} catch {
			return Promise.reject(new ConnectionDispatchError(`${op} could not be encoded.`, 'not-sent'))
		}
		return new Promise<Message>((resolve, reject) => {
			const timer = window.setTimeout(() => {
				this.pending.delete(id)
				reject(new ConnectionDispatchError(`${op} timed out after it was sent. The station may have applied it.`, 'unknown'))
			}, timeoutMs)
			this.pending.set(id, { resolve, reject, timer })
			try {
				socket.send(payload)
			} catch {
				window.clearTimeout(timer)
				this.pending.delete(id)
				reject(new ConnectionDispatchError(`${op} could not be sent.`, 'not-sent'))
			}
		})
	}

	onPush(listener: (message: Message) => void) {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	close() {
		const socket = this.socket
		this.socket = null
		if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'App disconnected')
		this.rejectAll(new ConnectionDispatchError('baskStream disconnected before the station answered. The station may have applied the request.', 'unknown'))
	}

	private onMessage(raw: unknown) {
		let message: Message
		try {
			message = JSON.parse(String(raw))
		} catch {
			this.close()
			return
		}
		const id = typeof message.id === 'string' ? message.id : ''
		const pending = this.pending.get(id)
		if (pending) {
			this.pending.delete(id)
			window.clearTimeout(pending.timer)
			if (message.op === 'error') pending.reject(new ConnectionDispatchError(String(message.message || message.code || 'baskStream request failed.'), 'rejected'))
			else pending.resolve(message)
			return
		}
		for (const listener of this.listeners) listener(message)
	}

	private onClosed() {
		this.socket = null
		this.rejectAll(new ConnectionDispatchError('Station connection closed before the station answered. The station may have applied the request.', 'unknown'))
		for (const listener of this.listeners) listener({ op: 'station_closed' })
	}

	private rejectAll(error: Error) {
		for (const [id, request] of this.pending) {
			window.clearTimeout(request.timer)
			request.reject(error)
			this.pending.delete(id)
		}
	}
}
