import type { ConnectionInput } from './types'

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
		if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
			return Promise.reject(new Error('baskStream is not connected.'))
		}
		const id = `bas-${++this.nextId}`
		this.socket.send(JSON.stringify({ op, id, ...fields }))
		return new Promise<Message>((resolve, reject) => {
			const timer = window.setTimeout(() => {
				this.pending.delete(id)
				reject(new Error(`${op} timed out.`))
			}, timeoutMs)
			this.pending.set(id, { resolve, reject, timer })
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
		this.rejectAll(new Error('baskStream disconnected.'))
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
			if (message.op === 'error') pending.reject(new Error(String(message.message || message.code || 'baskStream request failed.')))
			else pending.resolve(message)
			return
		}
		for (const listener of this.listeners) listener(message)
	}

	private onClosed() {
		this.socket = null
		this.rejectAll(new Error('Station connection closed.'))
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

