import { FormEventHandler, useCallback, useRef } from 'react'
import { TldrawUiButton, TldrawUiButtonIcon } from 'tldraw'
import { useAgent } from '../agent/TldrawAgentAppProvider'
import { ChatHistory } from './chat-history/ChatHistory'
import { ChatInput } from './ChatInput'
import { TodoList } from './TodoList'
import type { AgentStatus } from '../../shared/models'
import { ConnectionApprovals } from '../connections/ConnectionApprovals'

export function ChatPanel({ status, onClose }: { status: AgentStatus; onClose: () => void }) {
	const agent = useAgent()
	const inputRef = useRef<HTMLTextAreaElement>(null)

	const handleSubmit = useCallback<FormEventHandler<HTMLFormElement>>(
		async (e) => {
			e.preventDefault()
			if (!inputRef.current) return
			const formData = new FormData(e.currentTarget)
			const value = formData.get('input') as string

			// If the user's message is empty (or only whitespace), just cancel the current request (if there is one)
			if (value.trim() === '') {
				agent.cancel()
				return
			}

			// Clear the chat input (context is cleared after it's captured in requestAgentActions)
			inputRef.current.value = ''

			// Sending a new message to the agent should interrupt the current request
			agent.interrupt({
				input: {
					agentMessages: [value],
					bounds: agent.editor.getViewportPageBounds(),
					source: 'user',
					contextItems: agent.context.getItems(),
				},
			})
		},
		[agent]
	)

	const handleNewChat = useCallback(() => {
		agent.reset()
	}, [agent])

	return (
		<aside className="chat-panel" aria-label="Canvas AI">
			<div className="chat-header">
				<div className="chat-header-title">
					<strong>Canvas AI</strong>
					{status.providers.codex && (
						<span className="agent-subscription-badge">
							<span className="agent-subscription-dot" />
							ChatGPT connected
						</span>
					)}
				</div>
				<div className="chat-header-actions">
					<TldrawUiButton type="icon" aria-label="Start a new chat" tooltip="New chat" onClick={handleNewChat}>
						<TldrawUiButtonIcon icon="plus" small />
					</TldrawUiButton>
					<TldrawUiButton type="icon" aria-label="Close Canvas AI" tooltip="Close" onClick={onClose}>
						<TldrawUiButtonIcon icon="cross-2" small />
					</TldrawUiButton>
				</div>
			</div>
			<ChatHistory agent={agent} />
			<div className="chat-input-container">
				<ConnectionApprovals />
				<TodoList agent={agent} />
				<ChatInput handleSubmit={handleSubmit} inputRef={inputRef} status={status} />
			</div>
		</aside>
	)
}
