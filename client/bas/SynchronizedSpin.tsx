import { type ReactNode, useEffect, useRef } from 'react'
import { useEditor, useValue } from 'tldraw'
import type { RuntimeShapePresentation } from './runtimeMapping'

type Spin = RuntimeShapePresentation['spin']

export function SynchronizedHtmlSpin({
	center,
	children,
	spin,
}: {
	center: { x: number; y: number }
	children: ReactNode
	spin?: Spin
}) {
	const ref = useRef<HTMLDivElement>(null)
	useSynchronizedSpin(ref, spin)
	return <div ref={ref} className="runtime-shape-spin" style={{ transformOrigin: `${center.x}px ${center.y}px` }}>{children}</div>
}

export function SynchronizedSvgSpin({
	center,
	children,
	spin,
}: {
	center: { x: number; y: number }
	children: ReactNode
	spin?: Spin
}) {
	const ref = useRef<SVGGElement>(null)
	useSynchronizedSpin(ref, spin)
	return (
		<g
			ref={ref}
			className="runtime-svg-spin"
			style={{ transformBox: 'view-box', transformOrigin: `${center.x}px ${center.y}px` }}
		>
			{children}
		</g>
	)
}

function useSynchronizedSpin<T extends Element>(ref: React.RefObject<T | null>, spin?: Spin) {
	const editor = useEditor()
	const motionEnabled = useValue('runtime spin preference', () => editor.user.getAnimationSpeed() > 0, [editor])
	useEffect(() => {
		const element = ref.current
		if (!element || !spin || !motionEnabled) return
		const fullTurn = spin.direction === 'clockwise' ? 360 : -360
		const animation = element.animate(
			[{ transform: 'rotate(0deg)' }, { transform: `rotate(${fullTurn}deg)` }],
			{
				duration: spin.secondsPerTurn * 1_000,
				easing: 'linear',
				iterations: Infinity,
			},
		)
		animation.startTime = 0
		return () => animation.cancel()
	}, [ref, motionEnabled, spin?.direction, spin?.secondsPerTurn])
}
