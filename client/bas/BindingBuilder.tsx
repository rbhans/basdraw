import { LabelBehaviorFields, type LabelDraft } from './LabelBehaviorFields'
import { NumberField, ColorField } from './BehaviorFields'
import { RotationPivotControl } from './RotationPivotControl'
import { useState } from 'react'
import { TldrawUiButton, TldrawUiButtonLabel } from 'tldraw'
import {
	defaultMappingFor,
	evaluateMapping,
	formatMappedOutput,
	runtimePropertyLabel,
} from './runtimeMapping'
import type { BindingOptions, BindingValueMapping, LabelPlacement, PointSnapshot, RuntimeProperty, ShapeBinding } from './types'

type MappingKind = BindingValueMapping['kind']
type RotationMode = 'position' | 'spin'
type MovementMode = 'position' | 'travel'

export function BindingBuilder({
	binding,
	property,
	onCancel,
	onSubmit,
	snapshot,
	getConflict,
}: {
	binding?: ShapeBinding
	property: RuntimeProperty
	onCancel?: () => void
	onSubmit: (runtimeProperty: RuntimeProperty, mapping: BindingValueMapping, options?: BindingOptions) => void
	snapshot?: PointSnapshot
	getConflict?: (options?: BindingOptions) => string | null
}) {
	const initialProperty = binding?.runtimeProperty || property
	const booleanMotion = !binding && isBooleanSnapshot(snapshot) && (property === 'rotation' || property === 'movement')
	const initialMapping = binding?.mapping || (booleanMotion ? { kind: 'boolean', falseValue: 0, trueValue: 1 } as const : defaultMappingFor(initialProperty))
	const initialOptions = binding?.options
	const runtimeProperty = initialProperty
	const [mappingKind, setMappingKind] = useState<MappingKind>(initialMapping.kind)
	const [falseValue, setFalseValue] = useState(initialMapping.kind === 'boolean' ? String(initialMapping.falseValue) : '0')
	const [trueValue, setTrueValue] = useState(initialMapping.kind === 'boolean' ? String(initialMapping.trueValue) : '1')
	const [inputMin, setInputMin] = useState(initialMapping.kind === 'number' ? String(initialMapping.inputMin) : '0')
	const [inputMax, setInputMax] = useState(initialMapping.kind === 'number' ? String(initialMapping.inputMax) : '100')
	const [outputMin, setOutputMin] = useState(initialMapping.kind === 'number' ? String(initialMapping.outputMin) : '0')
	const [outputMax, setOutputMax] = useState(initialMapping.kind === 'number' ? String(initialMapping.outputMax) : '1')
	const [clamp, setClamp] = useState(initialMapping.kind === 'number' ? initialMapping.clamp : true)
	const [enumRules, setEnumRules] = useState(initialMapping.kind === 'enum' ? formatEnumRules(initialMapping) : 'off=0, on=1')
	const [fallback, setFallback] = useState(initialMapping.kind === 'enum' ? String(initialMapping.fallback) : '0')
	const [mappingOpen, setMappingOpen] = useState(false)

	const [labelDraft, setLabelDraft] = useState<LabelDraft>({
		labelPlacement: initialOptions?.kind === 'label' ? initialOptions.placement : 'bottom',
		labelGap: initialOptions?.kind === 'label' ? String(initialOptions.gap) : '5',
		labelColorMode: initialOptions?.kind === 'label' ? initialOptions.colorMode || 'status' : 'status',
		labelColor: initialOptions?.kind === 'label' ? initialOptions.color || '#202124' : '#202124',
		labelBackground: initialOptions?.kind === 'label' ? initialOptions.background || 'solid' : 'solid',
		labelFontSize: initialOptions?.kind === 'label' ? String(initialOptions.fontSize ?? 20) : '20',
		labelRadius: initialOptions?.kind === 'label' ? String(initialOptions.cornerRadius ?? 12) : '12',
		labelCaption: initialOptions?.kind === 'label' ? initialOptions.caption || '' : '',
		labelStackGap: initialOptions?.kind === 'label' ? String(initialOptions.stackGap ?? 4) : '4',
	})
	const { labelPlacement, labelGap, labelColorMode, labelColor, labelBackground, labelRadius, labelFontSize, labelCaption, labelStackGap } = labelDraft

	const [rotationMode, setRotationMode] = useState<RotationMode>(initialOptions?.kind === 'rotation' ? initialOptions.mode : booleanMotion ? 'spin' : 'position')
	const [secondsPerTurn, setSecondsPerTurn] = useState(initialOptions?.kind === 'rotation' ? String(initialOptions.secondsPerTurn) : '1.5')
	const [rotationDirection, setRotationDirection] = useState<'clockwise' | 'counterclockwise'>(initialOptions?.kind === 'rotation' ? initialOptions.direction : 'clockwise')
	const [pivotX, setPivotX] = useState(String(initialOptions?.kind === 'rotation' ? (initialOptions.pivot?.x ?? 0.5) * 100 : 50))
	const [pivotY, setPivotY] = useState(String(initialOptions?.kind === 'rotation' ? (initialOptions.pivot?.y ?? 0.5) * 100 : 50))
	const [restAngle, setRestAngle] = useState(initialOptions?.kind === 'rotation' ? String(initialOptions.restAngle) : '0')

	const [movementMode, setMovementMode] = useState<MovementMode>(initialOptions?.kind === 'movement' ? initialOptions.mode : booleanMotion ? 'travel' : 'position')
	const [movementAxis, setMovementAxis] = useState<'x' | 'y'>(initialOptions?.kind === 'movement' ? initialOptions.axis : 'x')
	const [movementDirection, setMovementDirection] = useState<'positive' | 'negative'>(initialOptions?.kind === 'movement' ? initialOptions.direction : 'positive')
	const [movementDistance, setMovementDistance] = useState(initialOptions?.kind === 'movement' ? String(initialOptions.distance) : '100')
	const [secondsPerCycle, setSecondsPerCycle] = useState(initialOptions?.kind === 'movement' ? String(initialOptions.secondsPerCycle) : '2')

	const [levelColor, setLevelColor] = useState(initialOptions?.kind === 'levelFill' ? initialOptions.color : '#2f80ed')
	const [levelDirection, setLevelDirection] = useState<'up' | 'down' | 'left' | 'right'>(initialOptions?.kind === 'levelFill' ? initialOptions.direction : 'up')

	const mappedProperty = runtimeProperty !== 'fill' && runtimeProperty !== 'label'
	const mapping = mappedProperty ? buildMapping({
		mappingKind,
		falseValue,
		trueValue,
		inputMin,
		inputMax,
		outputMin,
		outputMax,
		clamp,
		enumRules,
		fallback,
	}) : { kind: 'auto' } satisfies BindingValueMapping
	const mappedOutput = snapshot && mappedProperty ? evaluateMapping(mapping, snapshot) : null
	const preview = mappedOutput == null ? null : previewOutput(runtimeProperty, mappedOutput, {
		rotationMode,
		restAngle,
		movementMode,
		movementAxis,
		movementDirection,
		movementDistance,
	})
	const options = bindingOptions({
		runtimeProperty,
		labelPlacement,
		labelGap,
		labelColorMode,
		labelColor,
		labelBackground,
		labelRadius,
		labelFontSize,
		labelCaption,
		labelStackGap,
		rotationMode,
		secondsPerTurn,
		pivotX,
		pivotY,
		rotationDirection,
		restAngle,
		movementMode,
		movementAxis,
		movementDirection,
		movementDistance,
		secondsPerCycle,
		levelColor,
		levelDirection,
	})
	const conflictError = getConflict?.(options)
	const [savedDraft] = useState(() => JSON.stringify([mapping, options]))
	const dirty = savedDraft !== JSON.stringify([mapping, options])
	const numericFields = [
		...(mappedProperty && mappingKind === 'number' ? [inputMin, inputMax, outputMin, outputMax] : []),
		...(mappedProperty && mappingKind === 'boolean' ? [falseValue, trueValue] : []),
		...(mappedProperty && mappingKind === 'enum' ? [fallback] : []),
		...(runtimeProperty === 'label' ? [labelGap, labelRadius, labelStackGap, labelFontSize] : []),
		...(runtimeProperty === 'rotation' ? [pivotX, pivotY] : []),
		...(runtimeProperty === 'rotation' && rotationMode === 'spin' ? [secondsPerTurn, restAngle] : []),
		...(runtimeProperty === 'movement' && movementMode === 'travel' ? [movementDistance, secondsPerCycle] : []),
	]
	const validationError = numericFields.some((value) => !value.trim() || !Number.isFinite(Number(value)))
		? 'Enter a number in each settings field.'
		: runtimeProperty === 'label' && (Number(labelFontSize) < 6 || Number(labelFontSize) > 144)
			? 'Use a text size between 6 and 144 px.'
		: mappedProperty && mappingKind === 'number' && Number(inputMin) === Number(inputMax)
			? 'Point minimum and maximum must be different.'
			: runtimeProperty === 'rotation' && rotationMode === 'spin' && (Number(secondsPerTurn) < 0.1 || Number(secondsPerTurn) > 60)
				? 'Use 0.1–60 seconds per turn.'
				: runtimeProperty === 'movement' && movementMode === 'travel' && (Number(secondsPerCycle) < 0.1 || Number(secondsPerCycle) > 60)
					? 'Use 0.1–60 seconds per cycle.'
					: mappedProperty && mappingKind === 'enum' && enumRules.split(',').some((rule) => {
						const separator = rule.lastIndexOf('=')
						return separator < 1 || !rule.slice(0, separator).trim() || !rule.slice(separator + 1).trim() || !Number.isFinite(Number(rule.slice(separator + 1)))
					}) ? 'Use value=number rules, separated by commas.' : ''

	const applyMappingDefaults = (next: BindingValueMapping) => {
		setMappingKind(next.kind)
		if (next.kind === 'boolean') {
			setFalseValue(String(next.falseValue))
			setTrueValue(String(next.trueValue))
		}
		if (next.kind === 'number') {
			setInputMin(String(next.inputMin))
			setInputMax(String(next.inputMax))
			setOutputMin(String(next.outputMin))
			setOutputMax(String(next.outputMax))
			setClamp(next.clamp)
		}
	}

	const changeRotationMode = (mode: RotationMode) => {
		setRotationMode(mode)
		applyMappingDefaults(mode === 'spin'
			? { kind: 'boolean', falseValue: 0, trueValue: 1 }
			: defaultMappingFor('rotation'))
	}

	const changeMovementMode = (mode: MovementMode) => {
		setMovementMode(mode)
		applyMappingDefaults(mode === 'travel'
			? { kind: 'boolean', falseValue: 0, trueValue: 1 }
			: defaultMappingFor('movement'))
	}

	return (
		<div className="binding-builder">
			<div className="binding-configuration">
				<div className="binding-subheading">
					<strong>{runtimePropertyLabel(runtimeProperty)}</strong>
					<span>{propertyDescription(runtimeProperty)}</span>
				</div>

				{runtimeProperty === 'label' && <LabelBehaviorFields draft={labelDraft} onChange={setLabelDraft} snapshot={snapshot} />}

				{runtimeProperty === 'rotation' && (
					<>
						<ModeSwitch
							label="Behavior"
							value={rotationMode}
							onChange={(value) => changeRotationMode(value as RotationMode)}
							options={[['position', 'Follow value'], ['spin', 'Spin while on']]}
						/>
						<RotationPivotControl x={pivotX} y={pivotY} onChange={(x, y) => { setPivotX(x); setPivotY(y) }} />
						{rotationMode === 'spin' && (
							<>
								<div className="mapping-grid">
									<NumberField label="Seconds per turn" value={secondsPerTurn} onChange={setSecondsPerTurn} />
									<NumberField label="Rest angle" value={restAngle} onChange={setRestAngle} />
								</div>
								<label className="binding-field">
									<span>Direction</span>
									<select value={rotationDirection} onChange={(event) => setRotationDirection(event.target.value as typeof rotationDirection)}>
										<option value="clockwise">Clockwise</option>
										<option value="counterclockwise">Counterclockwise</option>
									</select>
								</label>
							</>
						)}
					</>
				)}

				{runtimeProperty === 'movement' && (
					<>
						<ModeSwitch
							label="Behavior"
							value={movementMode}
							onChange={(value) => changeMovementMode(value as MovementMode)}
							options={[['position', 'Follow value'], ['travel', 'Move while on']]}
						/>
						<div className="mapping-grid">
							<label className="binding-field">
								<span>Axis</span>
								<select value={movementAxis} onChange={(event) => setMovementAxis(event.target.value as typeof movementAxis)}>
									<option value="x">Horizontal</option>
									<option value="y">Vertical</option>
								</select>
							</label>
							{movementMode === 'travel' && (
								<label className="binding-field">
									<span>Direction</span>
									<select value={movementDirection} onChange={(event) => setMovementDirection(event.target.value as typeof movementDirection)}>
										<option value="positive">{movementAxis === 'x' ? 'Right' : 'Down'}</option>
										<option value="negative">{movementAxis === 'x' ? 'Left' : 'Up'}</option>
									</select>
								</label>
							)}
						</div>
						{movementMode === 'travel' && (
							<div className="mapping-grid">
								<NumberField label="Travel distance (px)" value={movementDistance} onChange={setMovementDistance} />
								<NumberField label="Seconds per cycle" value={secondsPerCycle} onChange={setSecondsPerCycle} />
							</div>
						)}
					</>
				)}

				{runtimeProperty === 'levelFill' && (
					<div className="mapping-grid">
						<ColorField label="Fill color" value={levelColor} onChange={setLevelColor} />
						<label className="binding-field">
							<span>Fill direction</span>
							<select value={levelDirection} onChange={(event) => setLevelDirection(event.target.value as typeof levelDirection)}>
								<option value="up">Bottom to top</option>
								<option value="down">Top to bottom</option>
								<option value="right">Left to right</option>
								<option value="left">Right to left</option>
							</select>
						</label>
					</div>
				)}
			</div>

			{mappedProperty && mappingKind === 'number' && <div className="mapping-grid">
				<NumberField label="Point minimum" value={inputMin} onChange={setInputMin} />
				<NumberField label="Point maximum" value={inputMax} onChange={setInputMax} />
				<NumberField label={`Effect from (${outputUnit(runtimeProperty)})`} value={outputMin} onChange={setOutputMin} />
				<NumberField label={`Effect to (${outputUnit(runtimeProperty)})`} value={outputMax} onChange={setOutputMax} />
			</div>}
			{preview && <div className="mapping-preview"><span>{binding?.enabled === false ? 'If enabled' : 'Live result'}</span><strong>{preview}</strong></div>}
			{mappedProperty && snapshot && mappedOutput == null && <p role="status" className="mapping-helper">This value cannot drive the current mapping. Check Advanced mapping or choose another point.</p>}
			{mappedProperty && (
				<details className="binding-mapping" open={mappingOpen} onToggle={(event) => setMappingOpen(event.currentTarget.open)}>
					<summary>
						<span>Advanced mapping</span>
						<small>{mappingKindLabel(mappingKind)}</small>
					</summary>
					<div className="binding-mapping-content">
						<label className="binding-field">
							<span>Mapping type</span>
							<select value={mappingKind} onChange={(event) => setMappingKind(event.target.value as MappingKind)}>
								<option value="auto">Automatic</option>
								<option value="boolean">Boolean</option>
								<option value="number">Numeric range</option>
								<option value="enum">Enum values</option>
							</select>
						</label>
						{mappingKind === 'boolean' && (
							<div className="mapping-grid">
								<NumberField label="Off / false output" value={falseValue} onChange={setFalseValue} />
								<NumberField label="On / true output" value={trueValue} onChange={setTrueValue} />
							</div>
						)}
						{mappingKind === 'number' && (
							<>
								<label className="mapping-check"><input type="checkbox" checked={clamp} onChange={(event) => setClamp(event.target.checked)} />Clamp outside range</label>
							</>
						)}
						{mappingKind === 'enum' && (
							<>
								<label className="binding-field">
									<span>Value rules</span>
									<input value={enumRules} onChange={(event) => setEnumRules(event.target.value)} placeholder="off=0, on=1" />
								</label>
								<NumberField label="Fallback output" value={fallback} onChange={setFallback} />
							</>
						)}
						<p className="mapping-helper">{propertyHint(runtimeProperty, rotationMode, movementMode)}</p>
					</div>
				</details>
			)}

			{conflictError && <p role="alert" className="mapping-helper">{conflictError}</p>}
			{validationError ? <p role="alert" className="mapping-helper">{validationError}</p> : dirty && <small role="status">Unsaved changes</small>}
			<div className="binding-submit-row">
				{onCancel && <button type="button" className="secondary-button binding-cancel" onClick={onCancel}>Cancel</button>}
				<TldrawUiButton type="primary" disabled={Boolean(validationError || conflictError)} className="binding-submit" onClick={() => onSubmit(runtimeProperty, mapping, options)}>
					<TldrawUiButtonLabel>{binding ? 'Save changes' : 'Add behavior'}</TldrawUiButtonLabel>
				</TldrawUiButton>
			</div>
		</div>
	)
}

function outputUnit(property: RuntimeProperty) {
	return property === 'rotation' ? '°' : property === 'movement' ? 'px' : property === 'levelFill' ? '%' : property === 'scale' ? '×' : '0–1'
}

function isBooleanSnapshot(snapshot?: PointSnapshot) {
	if (!snapshot) return false
	return typeof snapshot.value === 'boolean'
		|| /boolean|bool/i.test(snapshot.valueType || '')
		|| (typeof snapshot.value === 'string' && /^(true|false)$/i.test(snapshot.value.trim()))
}

function formatEnumRules(mapping: Extract<BindingValueMapping, { kind: 'enum' }>) {
	return mapping.entries.map((entry) => `${entry.match}=${entry.output}`).join(', ')
}

function ModeSwitch({ label, value, onChange, options }: {
	label: string
	value: string
	onChange: (value: string) => void
	options: Array<[string, string]>
}) {
	return (
		<div className="binding-field">
			<span>{label}</span>
			<div className="binding-mode-switch" role="group" aria-label={label}>
				{options.map(([option, optionLabel]) => (
					<button key={option} type="button" className={value === option ? 'active' : ''} aria-pressed={value === option} onClick={() => onChange(option)}>
						{optionLabel}
					</button>
				))}
			</div>
		</div>
	)
}

function buildMapping(values: {
	mappingKind: MappingKind
	falseValue: string
	trueValue: string
	inputMin: string
	inputMax: string
	outputMin: string
	outputMax: string
	clamp: boolean
	enumRules: string
	fallback: string
}): BindingValueMapping {
	switch (values.mappingKind) {
		case 'auto': return { kind: 'auto' }
		case 'boolean': return { kind: 'boolean', falseValue: numberOr(values.falseValue, 0), trueValue: numberOr(values.trueValue, 1) }
		case 'number': return {
			kind: 'number',
			inputMin: numberOr(values.inputMin, 0),
			inputMax: numberOr(values.inputMax, 100),
			outputMin: numberOr(values.outputMin, 0),
			outputMax: numberOr(values.outputMax, 1),
			clamp: values.clamp,
		}
		case 'enum': return {
			kind: 'enum',
			entries: values.enumRules.split(',').flatMap((rule) => {
				const separator = rule.lastIndexOf('=')
				if (separator < 1) return []
				const match = rule.slice(0, separator).trim()
				const output = Number(rule.slice(separator + 1).trim())
				return match && Number.isFinite(output) ? [{ match, output }] : []
			}),
			fallback: numberOr(values.fallback, 0),
		}
	}
}

function propertyHint(property: RuntimeProperty, rotationMode: RotationMode, movementMode: MovementMode) {
	if (property === 'rotation' && rotationMode === 'spin') return 'A boolean or mapped value of 0.5 and above turns continuous rotation on.'
	if (property === 'movement' && movementMode === 'travel') return 'A boolean or mapped value of 0.5 and above turns continuous travel on.'
	switch (property) {
		case 'visibility': return 'Visibility uses 0 for hidden and 1 for shown.'
		case 'opacity': return 'Opacity is clamped between 0 and 1.'
		case 'rotation': return 'Rotation output is measured in degrees around the selected pivot.'
		case 'scale': return 'Scale is clamped between 0.05× and 4×.'
		case 'movement': return 'Move output is measured in canvas pixels from the saved position.'
		case 'levelFill': return 'Percentage fill is clamped between 0% and 100%.'
		default: return ''
	}
}

function propertyDescription(property: RuntimeProperty) {
	switch (property) {
		case 'label': return 'Always shows the complete point value.'
		case 'fill': return 'Colors the shape from point value and status.'
		case 'levelFill': return 'Fills closed geometry from 0 to 100%.'
		case 'visibility': return 'Shows or hides the shape from a mapped value.'
		case 'opacity': return 'Fades the shape from a mapped value.'
		case 'rotation': return 'Positions or continuously spins around a chosen pivot.'
		case 'scale': return 'Resizes visually without changing saved geometry.'
		case 'movement': return 'Positions or continuously travels along one axis.'
	}
}

function previewOutput(property: RuntimeProperty, output: number, options: {
	rotationMode: RotationMode
	restAngle: string
	movementMode: MovementMode
	movementAxis: 'x' | 'y'
	movementDirection: 'positive' | 'negative'
	movementDistance: string
}) {
	if (property === 'rotation' && options.rotationMode === 'spin') return output >= 0.5 ? 'Spinning' : `Stopped at ${numberOr(options.restAngle, 0)}°`
	if (property === 'movement' && options.movementMode === 'travel') {
		if (output < 0.5) return 'Stopped at saved position'
		const direction = options.movementAxis === 'x'
			? options.movementDirection === 'positive' ? 'right' : 'left'
			: options.movementDirection === 'positive' ? 'down' : 'up'
		return `Moving ${numberOr(options.movementDistance, 100)}px ${direction}`
	}
	return formatMappedOutput(property, output)
}

function bindingOptions(values: {
	runtimeProperty: RuntimeProperty
	labelPlacement: LabelPlacement
	labelGap: string
	labelColorMode: 'status' | 'custom'
	labelColor: string
	labelBackground: 'solid' | 'none'
	labelFontSize: string
	labelRadius: string
	labelCaption: string
	labelStackGap: string
	rotationMode: RotationMode
	secondsPerTurn: string
	pivotX: string
	pivotY: string
	rotationDirection: 'clockwise' | 'counterclockwise'
	restAngle: string
	movementMode: MovementMode
	movementAxis: 'x' | 'y'
	movementDirection: 'positive' | 'negative'
	movementDistance: string
	secondsPerCycle: string
	levelColor: string
	levelDirection: 'up' | 'down' | 'left' | 'right'
}): BindingOptions | undefined {
	if (values.runtimeProperty === 'label') {
		return {
			kind: 'label',
			placement: values.labelPlacement,
			gap: Math.max(0, numberOr(values.labelGap, 5)),
			colorMode: values.labelColorMode,
			color: values.labelColor,
			background: values.labelBackground,
			fontSize: Math.min(144, Math.max(6, numberOr(values.labelFontSize, 20))),
			cornerRadius: Math.max(0, numberOr(values.labelRadius, 12)),
			caption: values.labelCaption.trim(),
			stackGap: Math.max(0, numberOr(values.labelStackGap, 4)),
		}
	}
	if (values.runtimeProperty === 'rotation') {
		return {
			kind: 'rotation',
			mode: values.rotationMode,
			secondsPerTurn: Math.min(60, Math.max(0.1, numberOr(values.secondsPerTurn, 1.5))),
			direction: values.rotationDirection,
			restAngle: numberOr(values.restAngle, 0),
			pivot: { x: numberOr(values.pivotX, 50) / 100, y: numberOr(values.pivotY, 50) / 100 },
		}
	}
	if (values.runtimeProperty === 'movement') {
		return {
			kind: 'movement',
			mode: values.movementMode,
			axis: values.movementAxis,
			direction: values.movementDirection,
			distance: Math.min(10_000, Math.max(0, numberOr(values.movementDistance, 100))),
			secondsPerCycle: Math.min(120, Math.max(0.2, numberOr(values.secondsPerCycle, 2))),
		}
	}
	if (values.runtimeProperty === 'levelFill') return { kind: 'levelFill', color: values.levelColor, direction: values.levelDirection }
	return undefined
}

function mappingKindLabel(kind: MappingKind) {
	switch (kind) {
		case 'auto': return 'Automatic'
		case 'boolean': return 'On / off'
		case 'number': return 'Numeric range'
		case 'enum': return 'Enum values'
	}
}

function numberOr(value: string, fallback: number) {
	const parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : fallback
}
