import { useEffect, useState } from 'react'
import { TldrawUiButton, TldrawUiButtonLabel, TldrawUiInput, useEditor, type TLShape } from 'tldraw'
import { useWorkspace } from './BasWorkspaceContext'
import { behaviorDefinitions, behaviorConflict, resolveBehaviorChannels } from './behaviorDefinitions'
import { unsupportedBindingCount } from './shapeBindings'
import { BindingBuilder } from './BindingBuilder'
import { BehaviorPointPicker } from './BehaviorPointPicker'
import { usePointDrag, type DraggedPoint } from './PointDrag'
import { NavigationBehavior } from './NavigationBehavior'
import { shapeNavigation } from './shapeIdentity'
import type { PointSnapshot, RuntimeProperty, ShapeBinding, StationNode } from './types'

const effects = Object.entries(behaviorDefinitions).map(([property, definition]) => ({ property: property as RuntimeProperty, ...definition }))
const effectLabel = (property: RuntimeProperty) => behaviorDefinitions[property].label
const effectGroups = ['Display', 'Appearance', 'Motion']

export function BehaviorInspector({ shape }: { shape: TLShape }) {
	const workspace = useWorkspace()
	const editor = useEditor()
	const drag = usePointDrag()
	const [seed, setSeed] = useState<DraggedPoint | undefined>()
	const bindings = workspace.document.bindings.filter((binding) => binding.shapeId === shape.id)
	const activeIds = new Set(resolveBehaviorChannels(bindings).map((binding) => binding.id))
	const [openId, setOpenId] = useState<string | null>(null)
	const [adding, setAdding] = useState(false)
	const [newEffect, setNewEffect] = useState<RuntimeProperty | null>(null)
	const [reset, setReset] = useState(0)
	const [addingNavigation, setAddingNavigation] = useState(false)
	const [actionError, setActionError] = useState<string | null>(null)
	const navigation = shapeNavigation(shape)
	const locked = shape.isLocked || editor.getIsReadonly()
	const close = () => { setOpenId(null); setAdding(false); setAddingNavigation(false); setNewEffect(null); setSeed(undefined); setActionError(null); setReset((value) => value + 1) }
	useEffect(() => {
		if (drag.pending?.shapeId !== shape.id) return
		setSeed(drag.pending); setAdding(true); setNewEffect(null); setOpenId(null); drag.request(null)
	}, [drag.pending, drag.request, shape.id])
	return <section className="behavior-inspector" aria-label="Shape behaviors">
		<div className="behavior-section-heading"><strong>Behaviors</strong><small>{bindings.length + (navigation ? 1 : 0) || ''}</small></div>
		{!bindings.length && !navigation && !adding && !addingNavigation && <p>Add live-point effects or navigate to another shape.</p>}
		{unsupportedBindingCount(shape) > 0 && <p role="status">{unsupportedBindingCount(shape)} unsupported behavior(s) preserved but not run. Open in a compatible version to edit them.</p>}
		{actionError && <p role="alert">{actionError}</p>}
		{locked && <p>Unlock this shape to edit its behaviors.</p>}
		{editor.getShapeAncestors(shape).some((ancestor) => ancestor.type === 'group') && <p>For motion and appearance, this shape's enabled behavior takes priority over the same effect on its group. Different effects still combine.</p>}
		{bindings.map((binding) => {
			const open = openId === binding.id
			const online = workspace.connectedProfile?.alias === binding.stationAlias
			// External edits, including undo/redo, replace drafts with the saved configuration.
			const configurationKey = JSON.stringify([binding.pointReference, binding.stationAlias, binding.mapping, binding.options, binding.name, binding.enabled, reset])
			return <div className="behavior-item" key={binding.id}>
				<div className="behavior-item-heading">
					<button type="button" className="behavior-expand" aria-expanded={open} aria-controls={`behavior-${binding.id}`} onClick={() => { setOpenId(open ? null : binding.id); setAdding(false) }}>
						<span className="behavior-chevron" aria-hidden="true">{open ? '⌄' : '›'}</span>
						<span><strong>{binding.name || effectLabel(binding.runtimeProperty)}</strong><small title={binding.pointReference}>{binding.pointLabel}</small></span>
					</button>
					<input type="checkbox" role="switch" aria-label={`Enable ${effectLabel(binding.runtimeProperty)} for ${binding.pointLabel}`} checked={binding.enabled !== false} disabled={locked} onChange={(event) => setActionError(workspace.setBindingEnabled(binding.id, event.target.checked))} />
				</div>
				{open && <div className="behavior-state">{binding.enabled === false ? 'Disabled · settings retained' : online ? 'Enabled' : `Offline · ${binding.stationAlias}`}</div>}
				{binding.enabled !== false && !activeIds.has(binding.id) && <p role="alert">Not running: an earlier enabled behavior controls the same effect. Disable one or edit its settings to resolve this conflict.</p>}
				{open && <div id={`behavior-${binding.id}`}>
					<fieldset disabled={locked} className="behavior-editor-fieldset">
						<BehaviorEditor key={configurationKey} shape={shape} property={binding.runtimeProperty} binding={binding} onDone={close} />
						<TldrawUiButton type="normal" className="behavior-remove" onClick={() => { const error = workspace.removeBinding(binding.id); setActionError(error); if (!error) close() }}><TldrawUiButtonLabel>Remove behavior</TldrawUiButtonLabel></TldrawUiButton>
					</fieldset>
				</div>}
			</div>
		})}
		{(navigation || addingNavigation) && <NavigationBehavior key={`navigation:${JSON.stringify(navigation)}:${addingNavigation}`} shape={shape} initiallyOpen={addingNavigation} onDone={() => setAddingNavigation(false)} />}
		{adding ? <div className="behavior-add">
			{newEffect ? <>
				<div className="behavior-section-heading"><strong>Add {effectLabel(newEffect).toLowerCase()}</strong><button type="button" onClick={() => setNewEffect(null)}>Back</button></div>
				<BehaviorEditor key={newEffect} shape={shape} property={newEffect} initialPoint={seed} onDone={close} />
			</> : <>
				<p>What should this shape do?</p>
				{seed && <p>Using {seed.point.display || seed.point.name || seed.point.ord} for a new effect. To replace an existing driver, open its effect and choose Change point.</p>}
				{effectGroups.map((group) => <div className="behavior-effect-group" key={group}><strong>{group}</strong><div className="behavior-effect-grid">{effects.filter((effect) => effect.group === group).map((effect) => {
					return <TldrawUiButton type="normal" key={effect.property} onClick={() => {
						setNewEffect(effect.property)
					}}><TldrawUiButtonLabel><strong>{effect.label}</strong><small>{effect.description}</small></TldrawUiButtonLabel></TldrawUiButton>
				})}</div></div>)}
				<div className="behavior-effect-group"><strong>Navigation</strong><div className="behavior-effect-grid"><TldrawUiButton type="normal" onClick={() => { setAdding(false); setAddingNavigation(true) }}><TldrawUiButtonLabel><strong>Navigate to shape</strong><small>{navigation ? 'Edit existing navigation' : 'Jump to a named destination'}</small></TldrawUiButtonLabel></TldrawUiButton></div></div>
				<TldrawUiButton type="normal" onClick={close}><TldrawUiButtonLabel>Cancel</TldrawUiButtonLabel></TldrawUiButton>
			</>}
		</div> : <TldrawUiButton type="normal" disabled={locked} className="behavior-add-button" onClick={() => { setAdding(true); setOpenId(null) }}><TldrawUiButtonLabel>+ Add behavior</TldrawUiButtonLabel></TldrawUiButton>}
	</section>
}

function BehaviorEditor({ shape, property, binding, initialPoint, onDone }: { shape: TLShape; property: RuntimeProperty; binding?: ShapeBinding; initialPoint?: DraggedPoint; onDone: () => void }) {
	const workspace = useWorkspace()
	const [name, setName] = useState(binding?.name || '')
	const [saveError, setSaveError] = useState<string | null>(null)
	const [replacement, setReplacement] = useState<DraggedPoint | null>(initialPoint || null)
	const [picking, setPicking] = useState(!binding && !initialPoint)
	const pointReference = replacement ? replacement.point.slotPath || replacement.point.ord : binding?.pointReference
	const stationAlias = replacement?.stationAlias || binding?.stationAlias
	const connected = Boolean(workspace.connectedProfile)
	const sameStation = connected && workspace.connectedProfile?.alias === stationAlias
	const snapshot = sameStation && pointReference ? workspace.snapshots[pointReference] || replacement?.snapshot : undefined
	const ready = Boolean(binding || replacement)
	const staleReplacement = Boolean(replacement && !sameStation)
	return <div className="behavior-editor">
		<label className="binding-field"><span>Behavior name (optional)</span><TldrawUiInput value={name} onValueChange={setName} placeholder={effectLabel(property)} /></label>
		{saveError && <p role="alert">{saveError}</p>}
		{ready && <div className="behavior-driver">
			<div className="behavior-section-heading"><small>Driving point</small><TldrawUiButton type="normal" disabled={!connected} onClick={() => setPicking(true)}><TldrawUiButtonLabel>Change point</TldrawUiButtonLabel></TldrawUiButton></div>
			<strong>{replacement ? replacement.point.display || replacement.point.name || pointReference : binding?.pointLabel}</strong>
			<details><summary>Point path</summary><small>{stationAlias} · {pointReference}</small></details>
			<span>{snapshot ? snapshot.displayValue || String(snapshot.value ?? 'No value') : 'No live value'}</span>
			{replacement && binding && <small>Point change pending. Effect settings are kept.</small>}
		</div>}
		{picking && (connected ? <BehaviorPointPicker key={workspace.connectedProfile!.alias} onCancel={() => ready ? setPicking(false) : onDone()} onChoose={(point, value) => {
			setReplacement({ point, snapshot: value, stationAlias: workspace.connectedProfile!.alias }); setPicking(false)
		}} /> : <div className="behavior-connect-hint"><p>Connect to a station on the left to choose a driving point.</p><TldrawUiButton type="normal" onClick={onDone}><TldrawUiButtonLabel>Cancel</TldrawUiButtonLabel></TldrawUiButton></div>)}
		{!connected && binding && <small>You can edit saved settings offline. Connect to change the point.</small>}
		{staleReplacement && <p role="alert">The connection changed. Choose the point again before saving.</p>}
		{ready && <fieldset className="behavior-editor-fieldset" disabled={picking || staleReplacement}>
			<BindingBuilder binding={binding} property={property} snapshot={snapshot} getConflict={(options) => behaviorConflict({ id: binding?.id || 'draft', shapeId: shape.id, runtimeProperty: property, enabled: binding?.enabled, options, mapping: binding?.mapping || { kind: 'auto' }, pointReference: pointReference || '', pointLabel: '', stationAlias: stationAlias || '' }, workspace.document.bindings)} onCancel={onDone} onSubmit={(effect, mapping, options) => {
				const error = binding
					? workspace.updateBinding(binding.id, effect, mapping, options, replacement?.point, name.trim())
					: replacement ? workspace.createBinding(shape.id, effect, mapping, options, replacement.point, name.trim()) : 'Choose a point first.'
				setSaveError(error)
				if (!error) onDone()
			}} />
		</fieldset>}
	</div>
}
