import { useRef } from 'react'
import {
	DefaultStylePanel, usePassThroughWheelEvents, useEditor, useValue,
	type TLUiStylePanelProps,
} from 'tldraw'
import { useBasdrawPlugins } from '../plugins/PluginContext'
import { pluginRegistry } from '../plugins/builtinPlugins'

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
		{sections.filter((section) => section.supports(shape)).map((section) => {
			const Section = section.component
			return <Section key={`${section.id}:${shape.id}`} shape={shape} />
		})}
		</div>}
	</div>
}
