import { useLayoutEffect, useRef } from 'react'
import { useEditor, type Editor } from 'tldraw'
import { RuntimeAnimationController, type RuntimeCycle, type RuntimeValues } from './RuntimeAnimationController'

const controllers = new WeakMap<Editor, { controller: RuntimeAnimationController; users: number; tick: (elapsed: number) => void }>()

/** One SDK clock listener per mounted editor, released when the last visual unmounts. */
function acquire(editor: Editor) {
	let entry = controllers.get(editor)
	if (!entry) {
		const controller = new RuntimeAnimationController()
		const tick = (elapsed: number) => controller.tick(elapsed, editor.user.getAnimationSpeed() > 0)
		entry = { controller, users: 0, tick }; controllers.set(editor, entry)
		editor.on('tick', tick)
		controller.tick(0, editor.user.getAnimationSpeed() > 0)
	}
	entry.users++
	const current = entry
	return { controller: entry.controller, release: () => {
		if (--current.users === 0) { editor.off('tick', current.tick); current.controller.dispose(); controllers.delete(editor) }
	} }
}

export function useRuntimeCycle(id: string | undefined, kind: RuntimeCycle, seconds: number, paint: (value: number) => void) {
	const editor = useEditor()
	const callback = useRef(paint)
	const subscription = useRef<ReturnType<RuntimeAnimationController['subscribeCycle']> | null>(null)
	useLayoutEffect(() => { callback.current = paint })
	useLayoutEffect(() => {
		if (!id) { callback.current(0); return }
		const lease = acquire(editor)
		subscription.current = lease.controller.subscribeCycle(`${kind}:${id}`, kind, seconds, value => callback.current(value))
		return () => { subscription.current?.dispose(); subscription.current = null; lease.release() }
	}, [editor, id, kind])
	useLayoutEffect(() => { subscription.current?.update(seconds) })
}

/**
 * Values are painted imperatively; ticks never re-render React or write the store.
 * An inactive consumer paints its resting values once and holds no clock subscription,
 * so unbound shapes can keep a stable wrapper without costing a tick listener.
 */
export function useRuntimeValues(values: RuntimeValues, paint: (values: RuntimeValues) => void, active = true) {
	const editor = useEditor()
	const callback = useRef(paint)
	const latest = useRef(values)
	const subscription = useRef<ReturnType<RuntimeAnimationController['subscribeValues']> | null>(null)
	useLayoutEffect(() => { callback.current = paint; latest.current = values })
	useLayoutEffect(() => {
		if (!active) { callback.current(latest.current); return }
		const lease = acquire(editor)
		subscription.current = lease.controller.subscribeValues(latest.current, value => callback.current(value))
		return () => { subscription.current?.dispose(); subscription.current = null; lease.release() }
	}, [editor, active])
	useLayoutEffect(() => { if (active) subscription.current?.update(values); else callback.current(values) })
}
