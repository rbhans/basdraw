import { useEffect, useMemo } from 'react'
import {
	TldrawUiSelect, TldrawUiSelectTrigger, TldrawUiSelectValue,
	TldrawUiSelectContent, TldrawUiSelectItem, useValue,
} from 'tldraw'
import {
	type AgentModelName, type AgentReasoningEffort, type AgentStatus,
	getAvailableAgentModels, getAgentModelLabel,
} from '../../shared/models'
import { useAgent } from '../agent/TldrawAgentAppProvider'

export function AgentModelSettings({ status }: { status: AgentStatus }) {
	const agent = useAgent()
	const modelName = useValue('modelName', () => agent.modelName.getModelName(), [agent])
	const effort = useValue('reasoningEffort', () => agent.modelName.getReasoningEffort(), [agent])
	const models = useMemo(() => getAvailableAgentModels(status), [status])
	const selected = models.find((model) => model.name === modelName)
	const codexModel = selected?.provider === 'codex'
		? status.codex?.models.find((model) => model.id === selected.id) : undefined

	useEffect(() => {
		if (!selected && models[0]) agent.modelName.setModelName(models[0].name)
	}, [agent, models, selected])

	useEffect(() => {
		if (codexModel?.supportedReasoningEfforts.length &&
			!codexModel.supportedReasoningEfforts.some((option) => option.value === effort)) {
			agent.modelName.setReasoningEffort(codexModel.defaultReasoningEffort)
		}
	}, [agent, codexModel, effort])

	return (
		<div className="agent-model-settings" aria-label="AI response settings">
			<div className="agent-setting">
				<span id="agent-model-label" className="agent-setting-label">Model</span>
				<TldrawUiSelect id="agent-model" value={modelName}
					onValueChange={(value) => agent.modelName.setModelName(value as AgentModelName)}>
					<TldrawUiSelectTrigger ref={(element) => { element?.setAttribute('aria-labelledby', 'agent-model-label') }}>
						<TldrawUiSelectValue>{selected?.displayName || getAgentModelLabel(modelName)}</TldrawUiSelectValue>
					</TldrawUiSelectTrigger>
					<TldrawUiSelectContent side="top">
						{models.map((model) => <TldrawUiSelectItem key={model.name} value={model.name}
							label={model.displayName || getAgentModelLabel(model.name)} />)}
					</TldrawUiSelectContent>
				</TldrawUiSelect>
			</div>
			{!!codexModel?.supportedReasoningEfforts.length && <div className="agent-setting">
				<span id="agent-effort-label" className="agent-setting-label">Effort</span>
				<TldrawUiSelect id="agent-effort" value={effort}
					onValueChange={(value) => agent.modelName.setReasoningEffort(value as AgentReasoningEffort)}>
					<TldrawUiSelectTrigger ref={(element) => { element?.setAttribute('aria-labelledby', 'agent-effort-label') }}>
						<TldrawUiSelectValue>{formatEffort(effort)}</TldrawUiSelectValue>
					</TldrawUiSelectTrigger>
					<TldrawUiSelectContent side="top" align="end">
						{codexModel.supportedReasoningEfforts.map((option) => <TldrawUiSelectItem
							key={option.value} value={option.value} label={formatEffort(option.value)} />)}
					</TldrawUiSelectContent>
				</TldrawUiSelect>
			</div>}
		</div>
	)
}

function formatEffort(effort: AgentReasoningEffort) {
	return effort === 'xhigh' ? 'Extra high' : effort.charAt(0).toUpperCase() + effort.slice(1)
}
