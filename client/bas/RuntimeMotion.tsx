import { type ReactNode, useRef } from 'react'
import type { RuntimeMotionCycle, RuntimeShapePresentation } from './runtimeMapping'
import { useRuntimeCycle } from './runtimeAnimationHooks'

type Spin = RuntimeShapePresentation['spin']
type Motion = RuntimeMotionCycle | undefined

// HTML and SVG are small output adapters over the same per-binding cycle.
export function SynchronizedHtmlSpin({ center, children, spin }: { center: { x: number; y: number }; children: ReactNode; spin?: Spin }) {
	const ref = useRef<HTMLDivElement>(null)
	useRuntimeCycle(spin?.id, 'spin', spin?.secondsPerTurn ?? 1, phase => {
		if (ref.current) ref.current.style.transform = spin ? `rotate(${phase * (spin.direction === 'counterclockwise' ? -360 : 360)}deg)` : ''
	})
	return <div ref={ref} className="runtime-shape-spin" style={{ transformOrigin: `${center.x}px ${center.y}px` }}>{children}</div>
}

export function SynchronizedSvgSpin({ center, children, spin }: { center: { x: number; y: number }; children: ReactNode; spin?: Spin }) {
	const ref = useRef<SVGGElement>(null)
	useRuntimeCycle(spin?.id, 'spin', spin?.secondsPerTurn ?? 1, phase => {
		if (!spin) ref.current?.removeAttribute('transform')
		else ref.current?.setAttribute('transform', `translate(${center.x} ${center.y}) rotate(${phase * (spin.direction === 'counterclockwise' ? -360 : 360)}) translate(${-center.x} ${-center.y})`)
	})
	return <g ref={ref}>{children}</g>
}

// The wrapper tree is identical whether or not a cycle runs, so starting, stopping or
// retargeting travel never remounts the shape content (iframes, charts, editors).
export function SynchronizedHtmlMotion({ children, motions }: { children: ReactNode; motions?: readonly RuntimeMotionCycle[] }) {
	return <HtmlMotion motion={motions?.[0]}><HtmlMotion motion={motions?.[1]}>{children}</HtmlMotion></HtmlMotion>
}
function HtmlMotion({ children, motion }: { children: ReactNode; motion?: Motion }) {
	const ref = useRef<HTMLDivElement>(null)
	useRuntimeCycle(motion?.id, 'travel', motion?.secondsPerCycle ?? 1, phase => {
		if (ref.current) ref.current.style.transform = motion ? `translate(${phase * motion.x}px, ${phase * motion.y}px)` : ''
	})
	return <div ref={ref} className="runtime-shape-motion">{children}</div>
}

export function SynchronizedSvgMotion({ children, motions }: { children: ReactNode; motions?: readonly RuntimeMotionCycle[] }) {
	return <SvgMotion motion={motions?.[0]}><SvgMotion motion={motions?.[1]}>{children}</SvgMotion></SvgMotion>
}
function SvgMotion({ children, motion }: { children: ReactNode; motion?: Motion }) {
	const ref = useRef<SVGGElement>(null)
	useRuntimeCycle(motion?.id, 'travel', motion?.secondsPerCycle ?? 1, phase => {
		if (!motion) ref.current?.removeAttribute('transform')
		else ref.current?.setAttribute('transform', `translate(${phase * motion.x} ${phase * motion.y})`)
	})
	return <g ref={ref}>{children}</g>
}
