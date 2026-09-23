import { Component, type ErrorInfo, type ReactNode } from 'react'
import { TldrawUiButton, TldrawUiButtonLabel } from 'tldraw'

type Props = {
	/** Plugin label shown to the user. */
	label: string
	/** Contribution id, for the console. */
	contribution: string
	/**
	 * inline: a small tldraw-styled notice with Retry (property sections, panels).
	 * silent: render nothing (canvas overlays, toolbar items).
	 * passthrough: render `fallbackChildren` undecorated (shape decorators keep the shape visible).
	 */
	fallback: 'inline' | 'silent' | 'passthrough'
	fallbackChildren?: ReactNode
	children: ReactNode
}

/**
 * Isolates one plugin contribution. A failing plugin component degrades to a small notice
 * (or to nothing) instead of replacing the whole editor with tldraw's error screen.
 */
export class PluginBoundary extends Component<Props, { error: unknown }> {
	override state: { error: unknown } = { error: null }

	static getDerivedStateFromError(error: unknown) {
		return { error: error ?? new Error('Unknown plugin error') }
	}

	override componentDidCatch(error: unknown, info: ErrorInfo) {
		console.error(`[basdraw] Plugin contribution ${this.props.contribution} failed.`, error, info.componentStack)
	}

	override render() {
		if (!this.state.error) return this.props.children
		if (this.props.fallback === 'passthrough') return this.props.fallbackChildren ?? null
		if (this.props.fallback === 'silent') return null
		return <div className="bas-plugin-error" role="alert">
			<span>{this.props.label} could not display this section.</span>
			<TldrawUiButton type="low" onClick={() => this.setState({ error: null })}><TldrawUiButtonLabel>Retry</TldrawUiButtonLabel></TldrawUiButton>
		</div>
	}
}
