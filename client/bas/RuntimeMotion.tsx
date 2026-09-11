import { type ReactNode, useRef } from 'react'
import type { RuntimeShapePresentation } from './runtimeMapping'
import { useRuntimeCycle } from './runtimeAnimationHooks'

type Spin = RuntimeShapePresentation['spin']
type Motion = RuntimeShapePresentation['motion']

// HTML and SVG are small output adapters over the same per-binding cycle.
export function SynchronizedHtmlSpin({ center, children, spin }: { center: { x: number; y: number }; children: ReactNode; spin?: Spin }) {
	const ref = useRef<HTMLDivElement>(null)
	useRuntimeCycle(spin?.id, 'spin', spin?.secondsPerTurn ?? 1, phase => {
		if (ref.current) ref.current.style.transform = `rotate(${phase * (spin?.direction === 'counterclockwise' ? -360 : 360)}deg)`
	})
	return <div ref={ref} className="runtime-shape-spin" style={{ transformOrigin: `${center.x}px ${center.y}px` }}>{children}</div>
}

export function SynchronizedSvgSpin({ center, children, spin }: { center: { x: number; y: number }; children: ReactNode; spin?: Spin }) {
	const ref = useRef<SVGGElement>(null)
	useRuntimeCycle(spin?.id, 'spin', spin?.secondsPerTurn ?? 1, phase => {
		ref.current?.setAttribute('transform', `translate(${center.x} ${center.y}) rotate(${phase * (spin?.direction === 'counterclockwise' ? -360 : 360)}) translate(${-center.x} ${-center.y})`)
	})
	return <g ref={ref}>{children}</g>
}

export function SynchronizedHtmlMotion({ children, motion, motions }: { children: ReactNode; motion?: Motion; motions?: NonNullable<Motion>[] }) {
	return motions ? motions.reduceRight<ReactNode>((content, item) => <HtmlMotion key={item.id} motion={item}>{content}</HtmlMotion>, children) : <HtmlMotion motion={motion}>{children}</HtmlMotion>
}
function HtmlMotion({ children, motion }: { children: ReactNode; motion?: Motion }) {
	const ref = useRef<HTMLDivElement>(null)
	useRuntimeCycle(motion?.id, 'travel', motion?.secondsPerCycle ?? 1, phase => {
		if (ref.current) ref.current.style.transform = `translate(${phase * (motion?.x ?? 0)}px, ${phase * (motion?.y ?? 0)}px)`
	})
	return <div ref={ref} className="runtime-shape-motion">{children}</div>
}

export function SynchronizedSvgMotion({ children, motion, motions }: { children: ReactNode; motion?: Motion; motions?: NonNullable<Motion>[] }) {
	return motions ? motions.reduceRight<ReactNode>((content, item) => <SvgMotion key={item.id} motion={item}>{content}</SvgMotion>, children) : <SvgMotion motion={motion}>{children}</SvgMotion>
}
function SvgMotion({ children, motion }: { children: ReactNode; motion?: Motion }) {
	const ref = useRef<SVGGElement>(null)
	useRuntimeCycle(motion?.id, 'travel', motion?.secondsPerCycle ?? 1, phase => {
		ref.current?.setAttribute('transform', `translate(${phase * (motion?.x ?? 0)} ${phase * (motion?.y ?? 0)})`)
	})
	return <g ref={ref}>{children}</g>
}
