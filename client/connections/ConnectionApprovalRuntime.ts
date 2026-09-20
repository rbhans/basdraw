import type { JsonValue } from 'tldraw'

export type PendingConnectionApproval = {
	id: string
	ownerAgentId: string
	connectionId: string
	connectionLabel: string
	toolId: string
	toolDescription: string
	arguments: Record<string, JsonValue>
}

type PendingEntry = PendingConnectionApproval & { resolve: (approved: boolean) => void }

/**
 * UI-neutral confirmation boundary for agent-initiated connection writes.
 * Connection adapters cannot bypass this runtime by describing a tool as read-only;
 * the effect declared by the adapter is checked again immediately before execution.
 */
export class ConnectionApprovalRuntime {
	private pending = new Map<string, PendingEntry>()
	private listeners = new Set<() => void>()
	private snapshot: PendingConnectionApproval[] = []
	private sequence = 0

	request(input: Omit<PendingConnectionApproval, 'id'>) {
		const id = `connection-approval-${Date.now()}-${++this.sequence}`
		return new Promise<boolean>((resolve) => {
			this.pending.set(id, { ...input, id, resolve })
			this.emit()
		})
	}

	resolve(id: string, approved: boolean) {
		const entry = this.pending.get(id)
		if (!entry) return
		this.pending.delete(id)
		entry.resolve(approved)
		this.emit()
	}

	cancelOwner(ownerAgentId: string) {
		for (const entry of [...this.pending.values()]) {
			if (entry.ownerAgentId === ownerAgentId) this.resolve(entry.id, false)
		}
	}

	getSnapshot = () => this.snapshot

	subscribe = (listener: () => void) => {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	private emit() {
		this.snapshot = [...this.pending.values()].map(({ resolve: _resolve, ...entry }) => entry)
		for (const listener of this.listeners) listener()
	}
}

export const connectionApprovalRuntime = new ConnectionApprovalRuntime()
