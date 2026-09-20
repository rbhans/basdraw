import { useState } from 'react'
import { TldrawUiButton, TldrawUiButtonLabel, TldrawUiIcon } from 'tldraw'
import type { AgentStatus } from '../../shared/models'

export function AgentSetupPanel({
	status,
	onRefresh,
}: {
	status: AgentStatus
	onRefresh: () => void
}) {
	const [loginError, setLoginError] = useState<string | null>(null)
	const [startingLogin, setStartingLogin] = useState(false)
	const codex = status.codex

	const startLogin = async () => {
		setStartingLogin(true)
		setLoginError(null)
		try {
			const response = await fetch('/agent/login', { method: 'POST' })
			const result = await response.json() as { authUrl?: string; connected?: boolean; error?: string }
			if (!response.ok) throw new Error(result.error || 'ChatGPT sign-in could not start.')
			if (result.authUrl) window.open(result.authUrl, '_blank', 'noopener,noreferrer')
			if (result.connected) onRefresh()
		} catch (error) {
			setLoginError(error instanceof Error ? error.message : 'ChatGPT sign-in could not start.')
		} finally {
			setStartingLogin(false)
		}
	}

	return (
		<aside className="chat-panel agent-setup-panel" aria-label="Canvas AI setup">
			<div className="agent-setup-heading">
				<TldrawUiIcon icon="comment" label="" />
				<div>
					<strong>Connect Canvas AI</strong>
					<p>Use the ChatGPT subscription already signed into Codex on this computer.</p>
				</div>
			</div>

			<div className="agent-provider-list">
				<div className="agent-provider-row">
					<div>
						<strong>ChatGPT through Codex</strong>
						<code>{codex?.available ? 'Local Codex App Server' : 'Codex bridge unavailable'}</code>
					</div>
					{codex?.authenticated ? (
						<span className="agent-provider-state is-connected">{codex.planType || 'Connected'}</span>
					) : codex?.available ? (
						<TldrawUiButton type="primary" onClick={startLogin} disabled={startingLogin}>
							<TldrawUiButtonLabel>{startingLogin ? 'Starting…' : 'Sign in'}</TldrawUiButtonLabel>
						</TldrawUiButton>
					) : (
						<span className="agent-provider-state">Unavailable</span>
					)}
				</div>
			</div>

			<div className="agent-setup-instructions">
				<strong>No separate API billing</strong>
				<p>Basdraw uses the local Codex App Server and its ChatGPT login. Your normal ChatGPT/Codex subscription limits apply.</p>
			</div>

			<div className="agent-setup-note">
				<strong>Local by design</strong>
				<p>The bridge listens only on this computer. Login tokens stay under Codex management and are never copied into basdraw, the canvas, or its knowledge database.</p>
			</div>

			{loginError && <p className="agent-setup-error">{loginError}</p>}
			<TldrawUiButton type="normal" onClick={onRefresh}>
				<TldrawUiButtonLabel>Refresh subscription status</TldrawUiButtonLabel>
			</TldrawUiButton>

			<details className="agent-api-alternatives">
				<summary>Optional API-key providers</summary>
				<p>OpenAI, Anthropic and Google adapters remain available for deployments that choose API billing, but they are not required for local subscription use.</p>
			</details>
		</aside>
	)
}
