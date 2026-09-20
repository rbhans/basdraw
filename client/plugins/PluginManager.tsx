import { useState } from 'react'
import {
	TldrawUiButton, TldrawUiButtonIcon, TldrawUiButtonLabel,
	TldrawUiPopover, TldrawUiPopoverTrigger, TldrawUiPopoverContent,
} from 'tldraw'
import { useBasdrawPlugins } from './PluginContext'
import { pluginRegistry } from './builtinPlugins'
import { ProjectKnowledgeButton } from '../knowledge/ProjectKnowledgeDialog'

export function PluginManager() {
	const { isEnabled, setEnabled } = useBasdrawPlugins()
	const [expanded, setExpanded] = useState<string | null>(null)
	return <TldrawUiPopover id="bas-addons" onOpenChange={() => setExpanded(null)}>
		<TldrawUiPopoverTrigger>
			<TldrawUiButton type="normal" aria-label="Manage basdraw add-ons">
				<TldrawUiButtonLabel>Add-ons</TldrawUiButtonLabel>
			</TldrawUiButton>
		</TldrawUiPopoverTrigger>
		<TldrawUiPopoverContent side="bottom" align="end" sideOffset={8} collisionPadding={8}>
			<section className="plugin-manager-popover" aria-label="Installed add-ons">
				<header><strong>Add-ons</strong><p>Choose the tools you need.</p></header>
				<div className="plugin-manager-list">
					{pluginRegistry.categories().map(({ category, plugins }) => {
						const enabledCount = plugins.filter((plugin) => isEnabled(plugin.id)).length
						const open = expanded === category.id
						return <section key={category.id} className="plugin-category">
							<TldrawUiButton type="normal" className="plugin-category-trigger"
								aria-expanded={open} aria-controls={`addons-${category.id}`}
								onClick={() => setExpanded(open ? null : category.id)}>
								<TldrawUiButtonLabel>{category.label}</TldrawUiButtonLabel>
								<span className="plugin-category-count">{enabledCount}/{plugins.length}</span>
								<TldrawUiButtonIcon icon={open ? 'chevron-up' : 'chevron-down'} small />
							</TldrawUiButton>
							{open && <div id={`addons-${category.id}`} className="plugin-category-items">
								{category.id === 'ai' && <ProjectKnowledgeButton />}
								{plugins.map((plugin) => <label key={plugin.id}>
									<input type="checkbox" checked={isEnabled(plugin.id)}
										onChange={(event) => setEnabled(plugin.id, event.currentTarget.checked)} />
									<span><strong>{plugin.label}</strong><small>{plugin.description}</small></span>
								</label>)}
							</div>}
						</section>
					})}
				</div>
			</section>
		</TldrawUiPopoverContent>
	</TldrawUiPopover>
}
