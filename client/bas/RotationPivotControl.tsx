import { TldrawUiButton, TldrawUiButtonLabel } from 'tldraw'

const presets = [
	['Top left', 0, 0], ['Top', 50, 0], ['Top right', 100, 0],
	['Left', 0, 50], ['Center', 50, 50], ['Right', 100, 50],
	['Bottom left', 0, 100], ['Bottom', 50, 100], ['Bottom right', 100, 100],
] as const

export function RotationPivotControl({ x, y, onChange }: { x: string; y: string; onChange: (x: string, y: string) => void }) {
	return <div className="binding-field">
		<span>Rotate around</span>
		<div className="rotation-pivot-presets">{presets.map(([label, px, py]) =>
			<TldrawUiButton key={label} type="normal" title={label} aria-label={`Rotation pivot: ${label}`} aria-pressed={x.trim() !== '' && y.trim() !== '' && Number(x) === px && Number(y) === py} isActive={x.trim() !== '' && y.trim() !== '' && Number(x) === px && Number(y) === py} onClick={() => onChange(String(px), String(py))}>
				<TldrawUiButtonLabel>{label}</TldrawUiButtonLabel>
			</TldrawUiButton>,
		)}</div>
		<div className="mapping-grid">
			<label className="binding-field"><span>X (%)</span><input aria-label="Rotation pivot X percent" type="number" value={x} onChange={(event) => onChange(event.target.value, y)} /></label>
			<label className="binding-field"><span>Y (%)</span><input aria-label="Rotation pivot Y percent" type="number" value={y} onChange={(event) => onChange(x, event.target.value)} /></label>
		</div>
		<small>50 / 50 is the center. Values outside 0–100 place the pivot outside the shape. The pivot follows resizing.</small>
	</div>
}
