import { snapshotState, readableTextColor } from './labelPresentation'
import type { LabelPlacement, PointSnapshot } from './types'
import { NumberField, ColorField } from './BehaviorFields'

export type LabelDraft = {
 labelPlacement: LabelPlacement; labelGap: string; labelColorMode: 'status' | 'custom'; labelColor: string; labelBackground: 'solid' | 'none'; labelRadius: string; labelFontSize: string; labelCaption: string; labelStackGap: string
}
export function LabelBehaviorFields({ draft, onChange, snapshot }: { draft: LabelDraft; onChange: (draft: LabelDraft) => void; snapshot?: PointSnapshot }) {
 const { labelPlacement, labelGap, labelColorMode, labelColor, labelBackground, labelRadius, labelFontSize, labelCaption, labelStackGap } = draft
 const setLabelPlacement = (value: LabelDraft['labelPlacement']) => onChange({ ...draft, labelPlacement: value })
 const setLabelGap = (value: LabelDraft['labelGap']) => onChange({ ...draft, labelGap: value })
 const setLabelColorMode = (value: LabelDraft['labelColorMode']) => onChange({ ...draft, labelColorMode: value })
 const setLabelColor = (value: LabelDraft['labelColor']) => onChange({ ...draft, labelColor: value })
 const setLabelBackground = (value: LabelDraft['labelBackground']) => onChange({ ...draft, labelBackground: value })
 const setLabelRadius = (value: LabelDraft['labelRadius']) => onChange({ ...draft, labelRadius: value })
 const setLabelCaption = (value: LabelDraft['labelCaption']) => onChange({ ...draft, labelCaption: value })
 const setLabelStackGap = (value: LabelDraft['labelStackGap']) => onChange({ ...draft, labelStackGap: value })
	return (
					<>
						<NumberField label="Text size (px)" value={labelFontSize} onChange={(value) => onChange({ ...draft, labelFontSize: value })} />
						<label className="binding-field"><span>Caption (optional)</span><input value={labelCaption} onChange={(event) => setLabelCaption(event.target.value)} placeholder="e.g. Supply temperature" /></label>
						<div className="mapping-grid">
							<label className="binding-field">
								<span>Placement</span>
								<select value={labelPlacement} onChange={(event) => setLabelPlacement(event.target.value as LabelPlacement)}>
									<option value="center">Center</option>
									<option value="top">Top</option>
									<option value="right">Right</option>
									<option value="bottom">Bottom</option>
									<option value="left">Left</option>
								</select>
							</label>
							<NumberField label="Distance from shape (px)" value={labelGap} onChange={setLabelGap} />
						</div>
						<NumberField label="Space between values (px)" value={labelStackGap} onChange={setLabelStackGap} />
						<small>Values on the same side stack in behavior-list order. Above or below the shape, the first value sets the stack's distance; later values use their space-between setting. Centered values ignore distance.</small>
						<label className="binding-field">
							<span>Value color</span>
							<select value={labelColorMode} onChange={(event) => setLabelColorMode(event.target.value as typeof labelColorMode)}>
								<option value="status">Reflect point status</option>
								<option value="custom">Custom color</option>
							</select>
						</label>
						{labelColorMode === 'custom' && <ColorField label="Custom color" value={labelColor} onChange={setLabelColor} />}
						<label className="binding-field"><span>Background</span><select value={labelBackground} onChange={(event) => setLabelBackground(event.target.value as 'solid' | 'none')}><option value="solid">Filled label</option><option value="none">None · text only</option></select></label>
						{labelBackground === 'solid' && <NumberField label="Corner roundness (px)" value={labelRadius} onChange={setLabelRadius} />}
						<div className="value-label-preview" data-state={snapshotState(snapshot || {})}>
							<span style={{
								borderRadius: numberOr(labelRadius, 12),
								fontSize: Math.min(144, Math.max(6, numberOr(labelFontSize, 20))),
								...(labelColorMode === 'custom' ? { backgroundColor: labelColor, color: readableTextColor(labelColor) } : {}),
								...(labelBackground === 'none' ? { backgroundColor: 'transparent', border: 0, boxShadow: 'none', padding: 0, color: labelColorMode === 'custom' ? labelColor : 'var(--tl-color-text)' } : {}),
							}}>
								{labelCaption.trim() ? `${labelCaption.trim()}: ` : ''}{snapshot ? snapshot.displayValue || String(snapshot.value ?? 'No value') : 'Live value'}
							</span>
						</div>
					</>
	)
}
function numberOr(value: string, fallback: number) {
	const parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : fallback
}
