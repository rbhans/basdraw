import { DefaultToolbar, ToolbarItem, TldrawUiMenuItem } from 'tldraw'
import { useDataShapeDialog } from './DataShapeDialog'

export function DataToolbar() {
	const open = useDataShapeDialog()
	return <DefaultToolbar maxItems={12} maxSizePx={650}>
		{['select', 'hand', 'draw', 'eraser', 'arrow', 'text'].map((tool) => <ToolbarItem key={tool} tool={tool} />)}
		<TldrawUiMenuItem id="bas-table" label="tool.bas-table" icon={<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M3 9h18M3 14h18M9 4v16" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>} onSelect={() => { open('table') }} />
		<TldrawUiMenuItem id="bas-trend" label="tool.bas-trend" icon={<svg viewBox="0 0 24 24"><path d="M3 4v16h18M6 15l4-6 4 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>} onSelect={() => { open('trend') }} />
		{['note', 'asset', 'rectangle', 'ellipse', 'triangle', 'diamond', 'hexagon', 'oval', 'rhombus', 'star', 'cloud', 'heart', 'x-box', 'check-box', 'arrow-left', 'arrow-up', 'arrow-down', 'arrow-right', 'line', 'highlight', 'laser', 'frame'].map((tool) => <ToolbarItem key={tool} tool={tool} />)}
	</DefaultToolbar>
}
