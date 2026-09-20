import { createContext, useContext, type ReactNode } from 'react'
import { ContainerProvider, DefaultDialogs, DefaultMenuPanel, DefaultNavigationPanel, type TLUiStylePanelProps } from 'tldraw'
import { DataShapeStylePanel } from '../bas/DataShapeStylePanel'
import { DataToolbar } from '../bas/DataToolbar'

// All shell and canvas popups share a viewport-sized layer. React context stays
// inside the editor, while menus/dialogs escape the panels' stacking contexts.
export const ShellUiContext = createContext<HTMLElement | null>(null)
export function ShellUiContainer({ children }: { children: ReactNode }) {
	const container = useContext(ShellUiContext)
	return container ? <ContainerProvider container={container}>{children}</ContainerProvider> : children
}
export function ShellDialogs() { return <ShellUiContainer><DefaultDialogs /></ShellUiContainer> }
export function ShellMenuPanel() { return <ShellUiContainer><DefaultMenuPanel /></ShellUiContainer> }
export function ShellNavigationPanel() { return <ShellUiContainer><DefaultNavigationPanel /></ShellUiContainer> }
export function ShellToolbar() { return <ShellUiContainer><DataToolbar /></ShellUiContainer> }
export function ShellStylePanel(props: TLUiStylePanelProps) { return <ShellUiContainer><DataShapeStylePanel {...props} /></ShellUiContainer> }
