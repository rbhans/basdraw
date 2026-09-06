export function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
	return <label className="binding-field"><span>{label}</span><input type="number" step="any" value={value} onChange={(event) => onChange(event.target.value)} /></label>
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
	return (
		<label className="binding-field">
			<span>{label}</span>
			<div className="color-field">
				<input type="color" value={value} onChange={(event) => onChange(event.target.value)} />
				<code>{value.toUpperCase()}</code>
			</div>
		</label>
	)
}
