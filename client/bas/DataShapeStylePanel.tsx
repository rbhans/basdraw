import { useRef } from 'react'
import {
	DefaultStylePanel, usePassThroughWheelEvents, useEditor, useValue,
	type TLShape, type TLUiStylePanelProps,
} from 'tldraw'
import { useBasdrawPlugins } from '../plugins/PluginContext'
import { pluginRegistry } from '../plugins/builtinPlugins'
import { PluginBoundary } from '../plugins/PluginBoundary'
import type { BasdrawPropertySection } from '../plugins/types'

export function DataShapeStylePanel(props: TLUiStylePanelProps) {
	const editor = useEditor()
	const panelRef = useRef<HTMLDivElement>(null)
	usePassThroughWheelEvents(panelRef)
	const shape = useValue('selected data shape', () => editor.getOnlySelectedShape(), [editor])
	const { enabled } = useBasdrawPlugins()
	const sections = pluginRegistry.propertySections(enabled)
	return <div className="bas-properties-stack" data-mobile={props.isMobile || undefined}>
		<DefaultStylePanel {...props} />
		{shape && <div ref={panelRef} className="bas-properties-card" role="region" aria-label="Shape behaviors and properties"
			onPointerMove={(event) => editor.markEventAsHandled(event)}
			onKeyDown={(event) => {
				if (event.key === 'Escape') { event.stopPropagation(); editor.focus() }
			}}>
		{sections.filter((section) => safeSupports(section, shape)).map((section) => {
			const Section = section.component
			return <PluginBoundary key={`${section.id}:${shape.id}`} label={section.pluginLabel} contribution={section.id} fallback="inline">
				<Section shape={shape} />
			</PluginBoundary>
		})}
		</div>}
	</div>
}

function safeSupports(section: BasdrawPropertySection, shape: TLShape) {
	try { return section.supports(shape) }
	catch (error) { console.error(`[basdraw] Property section ${section.id} failed to check support.`, error); return false }
}
