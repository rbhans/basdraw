import { TldrawUiButton, TldrawUiButtonLabel } from 'tldraw'

export function ChatPanelFallback() {
	return (
		<div className="chat-panel agent-setup-panel" role="alert">
			<p>Error loading chat history</p>
			<TldrawUiButton type="normal" onClick={() => window.location.reload()}>
				<TldrawUiButtonLabel>Reload app</TldrawUiButtonLabel>
			</TldrawUiButton>
		</div>
	)
}
