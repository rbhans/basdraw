import { useSyncExternalStore } from 'react'
import { TldrawUiButton, TldrawUiButtonIcon, TldrawUiButtonLabel } from 'tldraw'
import { useAgent } from '../agent/TldrawAgentAppProvider'
import { connectionApprovalRuntime, type PendingConnectionApproval } from './ConnectionApprovalRuntime'

export function ConnectionApprovals() {
	const agent = useAgent()
	const pending = useSyncExternalStore(
		connectionApprovalRuntime.subscribe,
		connectionApprovalRuntime.getSnapshot,
		connectionApprovalRuntime.getSnapshot,
	).filter((request) => request.ownerAgentId === agent.id)
	if (!pending.length) return null

	return <div className="connection-approvals" aria-live="polite">
		{pending.map((request) => <ApprovalCard key={request.id} request={request} />)}
	</div>
}

function ApprovalCard({ request }: { request: PendingConnectionApproval }) {
	const expired = request.status === 'expired'
	const highRisk = request.risk === 'high'
	const title = request.title ?? `Allow change to ${request.connectionLabel}?`
	const hasPreview = request.preview !== undefined && request.preview !== null
	return <section className="connection-approval" aria-label={title}>
		<strong>{title}</strong>
		{highRisk && !expired && <div className="inline-error" role="alert">
			High-risk change. It can override equipment control or clear active alarms. Check every value before allowing it.
		</div>}
		<p>{request.toolDescription}</p>
		<small>{request.connectionLabel} · {request.toolId}</small>
		<details open><summary>{hasPreview ? 'Proposed change' : 'Proposed request'}</summary><pre>{JSON.stringify(request.arguments, null, 2)}</pre></details>
		{hasPreview && <details><summary>{request.previewLabel ?? 'Current state'}</summary><pre>{JSON.stringify(request.preview, null, 2)}</pre></details>}
		{expired
			? <div className="inline-warning" role="status">This request expired and can no longer be approved. Ask again if the change is still needed.</div>
			: <small>Expires at {new Date(request.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small>}
		<div>
			{expired
				? <TldrawUiButton type="normal" onClick={() => connectionApprovalRuntime.dismiss(request.id)}>
					<TldrawUiButtonLabel>Dismiss</TldrawUiButtonLabel>
				</TldrawUiButton>
				: <>
					<TldrawUiButton type="normal" onClick={() => connectionApprovalRuntime.resolve(request.id, false)}>
						<TldrawUiButtonLabel>Cancel</TldrawUiButtonLabel>
					</TldrawUiButton>
					<TldrawUiButton type={highRisk ? 'danger' : 'primary'} onClick={() => connectionApprovalRuntime.resolve(request.id, true)}>
						{highRisk && <TldrawUiButtonIcon icon="warning-triangle" small />}
						<TldrawUiButtonLabel>Allow once</TldrawUiButtonLabel>
					</TldrawUiButton>
				</>}
		</div>
	</section>
}
