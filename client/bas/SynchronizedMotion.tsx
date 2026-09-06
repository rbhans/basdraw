import { type ReactNode, useEffect, useRef } from 'react'
import { useEditor, useValue } from 'tldraw'
import type { RuntimeShapePresentation } from './runtimeMapping'

type Motion = RuntimeShapePresentation['motion']

export function SynchronizedHtmlMotion({ children, motion, motions }: { children: ReactNode; motion?: Motion; motions?: NonNullable<Motion>[] }) {
	return motions ? motions.reduceRight<ReactNode>((content, item, index) => <HtmlMotion key={index} motion={item}>{content}</HtmlMotion>, children) : <HtmlMotion motion={motion}>{children}</HtmlMotion>
}

function HtmlMotion({ children, motion }: { children: ReactNode; motion?: Motion }) {
	const ref = useRef<HTMLDivElement>(null)
	useSynchronizedMotion(ref, motion)
	return <div ref={ref} className="runtime-shape-motion">{children}</div>
}

export function SynchronizedSvgMotion({ children, motion, motions }: { children: ReactNode; motion?: Motion; motions?: NonNullable<Motion>[] }) {
	return motions ? motions.reduceRight<ReactNode>((content, item, index) => <SvgMotion key={index} motion={item}>{content}</SvgMotion>, children) : <SvgMotion motion={motion}>{children}</SvgMotion>
}

function SvgMotion({ children, motion }: { children: ReactNode; motion?: Motion }) {
	const ref = useRef<SVGGElement>(null)
	useSynchronizedMotion(ref, motion)
	return <g ref={ref} className="runtime-svg-motion">{children}</g>
}

function useSynchronizedMotion<T extends Element>(ref: React.RefObject<T | null>, motion?: Motion) {
	const editor = useEditor()
	const motionEnabled = useValue('runtime movement preference', () => editor.user.getAnimationSpeed() > 0, [editor])
	useEffect(() => {
		const element = ref.current
		if (!element || !motion || !motionEnabled) return
		const destination = `translate3d(${motion.x}px, ${motion.y}px, 0)`
		const easing = 'cubic-bezier(0.77, 0, 0.175, 1)'
		const animation = element.animate(
			[
				{ transform: 'translate3d(0, 0, 0)', easing },
				{ transform: destination, easing, offset: 0.5 },
				{ transform: 'translate3d(0, 0, 0)' },
			],
			{
				duration: motion.secondsPerCycle * 1_000,
				iterations: Infinity,
			},
		)
		animation.startTime = 0
		return () => animation.cancel()
	}, [ref, motionEnabled, motion?.x, motion?.y, motion?.secondsPerCycle])
}
