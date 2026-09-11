import { DefaultToolbar, ToolbarItem, TldrawUiMenuItem } from 'tldraw'
import { useDataShapeDialog } from './DataShapeDialog'
import { useWebViewDialog } from './WebViewSettings'
import { useVectorPdfDialog } from './VectorPdfDialog'

export function DataToolbar() {
	const open = useDataShapeDialog()
	const openWebView = useWebViewDialog()
	const openPdf = useVectorPdfDialog()
	return <DefaultToolbar maxItems={12} maxSizePx={650}>
		{['select', 'hand', 'draw', 'eraser', 'arrow', 'text'].map((tool) => <ToolbarItem key={tool} tool={tool} />)}
		<TldrawUiMenuItem id="bas-import-pdf" label="tool.bas-import-pdf" icon={<svg viewBox="0 0 24 24"><path d="M14 3H5v18h14V8zM14 3v5h5M8 13h8M8 17h5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>} onSelect={openPdf} />
		<TldrawUiMenuItem id="bas-table" label="tool.bas-table" icon={<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M3 9h18M3 14h18M9 4v16" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>} onSelect={() => { open('table') }} />
		<TldrawUiMenuItem id="bas-trend" label="tool.bas-trend" icon={<svg viewBox="0 0 24 24"><path d="M3 4v16h18M6 15l4-6 4 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>} onSelect={() => { open('trend') }} />
		<TldrawUiMenuItem id="bas-web-view" label="tool.bas-web-view" icon={<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M3 9h18M6 6.5h.01M9 6.5h.01" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>} onSelect={openWebView} />
		{['note', 'asset', 'rectangle', 'ellipse', 'triangle', 'diamond', 'hexagon', 'oval', 'rhombus', 'star', 'cloud', 'heart', 'x-box', 'check-box', 'arrow-left', 'arrow-up', 'arrow-down', 'arrow-right', 'line', 'highlight', 'laser', 'frame'].map((tool) => <ToolbarItem key={tool} tool={tool} />)}
	</DefaultToolbar>
}
