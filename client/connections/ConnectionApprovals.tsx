import { useSyncExternalStore } from 'react'
import { TldrawUiButton, TldrawUiButtonLabel } from 'tldraw'
import { useAgent } from '../agent/TldrawAgentAppProvider'
import { connectionApprovalRuntime } from './ConnectionApprovalRuntime'

export function ConnectionApprovals() {
	const agent = useAgent()
	const pending = useSyncExternalStore(
		connectionApprovalRuntime.subscribe,
		connectionApprovalRuntime.getSnapshot,
		connectionApprovalRuntime.getSnapshot,
	).filter((request) => request.ownerAgentId === agent.id)
	if (!pending.length) return null

	return <div className="connection-approvals" aria-live="polite">
		{pending.map((request) => <section className="connection-approval" key={request.id}>
			<strong>Allow BAS write?</strong>
			<p>{request.toolDescription}</p>
			<small>{request.connectionLabel} · {request.toolId}</small>
			<details><summary>Arguments</summary><pre>{JSON.stringify(request.arguments, null, 2)}</pre></details>
			<div>
				<TldrawUiButton type="normal" onClick={() => connectionApprovalRuntime.resolve(request.id, false)}>
					<TldrawUiButtonLabel>Cancel</TldrawUiButtonLabel>
				</TldrawUiButton>
				<TldrawUiButton type="primary" onClick={() => connectionApprovalRuntime.resolve(request.id, true)}>
					<TldrawUiButtonLabel>Allow once</TldrawUiButtonLabel>
				</TldrawUiButton>
			</div>
		</section>)}
	</div>
}
