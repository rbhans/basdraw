import {
	DefaultToolbar, TldrawUiButton, TldrawUiButtonIcon, TldrawUiDropdownMenuRoot,
	TldrawUiDropdownMenuTrigger, TldrawUiDropdownMenuContent,
	TldrawUiMenuContextProvider, TldrawUiMenuItem, useReadonly,
} from 'tldraw'
import { pluginRegistry } from '../plugins/builtinPlugins'
import { useBasdrawPlugins } from '../plugins/PluginContext'
import { PluginBoundary } from '../plugins/PluginBoundary'
import type { BasdrawToolbarItem } from '../plugins/types'

export function DataToolbar() {
	const readonly = useReadonly()
	const { enabled } = useBasdrawPlugins()
	const groups = pluginRegistry.toolbarGroups(enabled)
	return <div className="bas-toolbar-row">
		<DefaultToolbar />
		{!readonly && <div className="bas-tool-groups" role="group" aria-label="Basdraw tools">
			{groups.map(({ group, items }) => <div className="bas-tool-group" key={group.id}>
				<TldrawUiDropdownMenuRoot id={`bas-tools-${group.id}`}>
					<TldrawUiDropdownMenuTrigger>
						<TldrawUiButton type="icon" title={group.label} aria-label={group.label}>
							<TldrawUiButtonIcon icon={group.icon} />
						</TldrawUiButton>
					</TldrawUiDropdownMenuTrigger>
					<TldrawUiDropdownMenuContent side="top" align="end" alignOffset={0}>
						<TldrawUiMenuContextProvider type="menu" sourceId="toolbar">
							{items.map((item) => <PluginBoundary key={item.id} label={item.id} contribution={item.id} fallback="silent"><PluginMenuItem item={item} /></PluginBoundary>)}
						</TldrawUiMenuContextProvider>
					</TldrawUiDropdownMenuContent>
				</TldrawUiDropdownMenuRoot>
			</div>)}
		</div>}
	</div>
}

function PluginMenuItem({ item }: { item: BasdrawToolbarItem }) {
	const onSelect = item.useSelect()
	return <TldrawUiMenuItem id={item.id} label={item.label} onSelect={onSelect} iconLeft={item.icon} />
}
