import { FormEventHandler, useState } from 'react'
import {
	TldrawUiButton, TldrawUiButtonIcon, TldrawUiButtonLabel,
	TldrawUiDropdownMenuRoot, TldrawUiDropdownMenuTrigger, TldrawUiDropdownMenuContent,
	TldrawUiMenuContextProvider, TldrawUiMenuItem, useValue,
} from 'tldraw'
import { useAgent } from '../agent/TldrawAgentAppProvider'
import { ContextItemTag } from './ContextItemTag'
import { SelectionTag } from './SelectionTag'
import { AgentModelSettings } from './AgentModelSettings'
import type { AgentStatus } from '../../shared/models'
import { useAccessPolicy } from '../access/AccessPolicyContext'

export function ChatInput({ handleSubmit, inputRef, status }: {
	handleSubmit: FormEventHandler<HTMLFormElement>
	inputRef: React.RefObject<HTMLTextAreaElement | null>
	status: AgentStatus
}) {
	const agent = useAgent()
	const { policy } = useAccessPolicy()
	const { editor } = agent
	const [inputValue, setInputValue] = useState('')
	const isGenerating = useValue('isGenerating', () => agent.requests.isGenerating(), [agent])
	const selectedShapes = useValue('selectedShapes', () => editor.getSelectedShapes(), [editor])
	const contextItems = useValue('contextItems', () => agent.context.getItems(), [agent])
	const isContextToolActive = useValue('isContextToolActive', () =>
		['target-shape', 'target-area'].includes(editor.getCurrentToolId()), [editor])
	const stopping = isGenerating && inputValue.trim() === ''

	return (
		<div className="chat-input">
			<form onSubmit={(event) => {
				event.preventDefault()
				if (!inputValue.trim() && !isGenerating) return
				handleSubmit(event)
				setInputValue('')
			}}>
				{(selectedShapes.length > 0 || contextItems.length > 0) && <div className="prompt-tags">
					{selectedShapes.length > 0 && <SelectionTag onClick={() => editor.selectNone()} />}
					{contextItems.map((item, i) => <ContextItemTag editor={editor}
						onClick={() => agent.context.remove(item)} key={'context-item-' + i} item={item} />)}
				</div>}
				<div className="chat-context-actions">
					<TldrawUiDropdownMenuRoot id="agent-context">
						<TldrawUiDropdownMenuTrigger>
							<TldrawUiButton type="normal" isActive={isContextToolActive}>
								<TldrawUiButtonIcon icon="plus" small />
								<TldrawUiButtonLabel>Add context</TldrawUiButtonLabel>
							</TldrawUiButton>
						</TldrawUiDropdownMenuTrigger>
						<TldrawUiDropdownMenuContent side="top" alignOffset={0}>
							<TldrawUiMenuContextProvider type="menu" sourceId="dialog">
								<TldrawUiMenuItem id="agent-pick-shapes" label="Pick shapes" iconLeft="tool-pointer"
									onSelect={() => { editor.setCurrentTool('target-shape'); editor.focus() }} />
								<TldrawUiMenuItem id="agent-pick-area" label="Pick an area" iconLeft="tool-frame"
									onSelect={() => { editor.setCurrentTool('target-area'); editor.focus() }} />
							</TldrawUiMenuContextProvider>
						</TldrawUiDropdownMenuContent>
					</TldrawUiDropdownMenuRoot>
				</div>
				<textarea ref={inputRef} name="input" aria-label="Message Canvas AI" autoComplete="off"
					placeholder={policy.ai === 'analyze' ? 'Ask for analysis of your canvas or connected data…' : 'Ask about your canvas, or describe a change…'} value={inputValue}
					onChange={(event) => setInputValue(event.currentTarget.value)}
					onKeyDown={(event) => {
						if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
							event.preventDefault()
							event.currentTarget.form?.requestSubmit()
						}
					}} />
				<div className="chat-actions">
					<AgentModelSettings status={status} />
					<TldrawUiButton type="primary" htmlButtonType="submit" className="chat-send"
						aria-label={stopping ? 'Stop generating' : 'Send message'}
						title={stopping ? 'Stop generating' : 'Send message'} disabled={!inputValue.trim() && !isGenerating}>
						<TldrawUiButtonIcon icon={stopping ? 'geo-rectangle' : 'arrow-left'} />
					</TldrawUiButton>
				</div>
			</form>
		</div>
	)
}
