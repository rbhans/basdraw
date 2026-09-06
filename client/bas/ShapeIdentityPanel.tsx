import { useState } from 'react'
import { TldrawUiInput, useEditor, type TLShape } from 'tldraw'
import { renameShape, shapeName } from './shapeIdentity'

export function ShapeIdentityPanel({ shape }: { shape: TLShape }) {
	const editor = useEditor()
	const [error, setError] = useState<string | null>(null)
	const commit = (value: string) => setError(renameShape(editor, shape.id, value))
	return <section className="bas-shape-identity" aria-label="Shape identity">
		<span>Shape name</span>
		<TldrawUiInput key={shapeName(shape)} aria-label="Shape name" defaultValue={shapeName(shape)} disabled={shape.isLocked || editor.getIsReadonly()} onComplete={commit} onBlur={commit} />
		{error && <small role="alert">{error}</small>}
	</section>
}
