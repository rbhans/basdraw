import { useEffect, useRef, useState } from 'react'
import { TldrawUiButton, TldrawUiButtonLabel, TldrawUiInput } from 'tldraw'
import { useWorkspace } from './BasWorkspaceContext'
import type { PointSnapshot, StationNode } from './types'

export function BehaviorPointPicker({ onChoose, onCancel }: {
	onChoose: (point: StationNode, snapshot?: PointSnapshot) => void
	onCancel: () => void
}) {
	const workspace = useWorkspace()
	const [query, setQuery] = useState('')
	const [results, setResults] = useState<StationNode[]>([])
	const [searching, setSearching] = useState(false)
	const [reading, setReading] = useState(false)
	const [error, setError] = useState('')
	const alive = useRef(true)
	useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
	useEffect(() => {
		let cancelled = false
		setResults([])
		setError('')
		setSearching(Boolean(query.trim()))
		if (!query.trim()) return
		const timer = window.setTimeout(() => {
			void workspace.search(query.trim()).then((nodes) => {
				if (!cancelled) setResults(nodes)
			}).catch((cause) => {
				if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
			}).finally(() => { if (!cancelled) setSearching(false) })
		}, 180)
		return () => { cancelled = true; window.clearTimeout(timer) }
	}, [query, workspace.search])
	const choose = async (point: StationNode) => {
		setReading(true)
		setError('')
		try {
			const snapshot = await workspace.readPoint(point)
			if (!snapshot || snapshot.ok === false) throw new Error('This point could not be read. Choose another point or try again.')
			if (alive.current) onChoose(point, snapshot)
		} catch (cause) {
			if (alive.current) setError(cause instanceof Error ? cause.message : String(cause))
		} finally { if (alive.current) setReading(false) }
	}
	const points = query.trim() ? results : workspace.selectedPoint ? [workspace.selectedPoint] : []
	return <div className="behavior-point-picker" aria-label="Choose driving point">
		<TldrawUiInput autoFocus placeholder="Search points…" aria-label="Search driving points" value={query} onValueChange={setQuery} />
		{!query.trim() && <small>{points.length ? 'Currently inspected point' : 'Search by name or path, or inspect a point in the station browser.'}</small>}
		<div className="behavior-point-results">
			{points.map((point) => <TldrawUiButton key={point.ord} type="normal" disabled={reading} title={point.slotPath || point.ord} onClick={() => void choose(point)}>
				<TldrawUiButtonLabel><strong>{point.display || point.name || point.ord}</strong><small>{point.slotPath || point.ord}</small></TldrawUiButtonLabel>
			</TldrawUiButton>)}
		</div>
		<div role="status">{error || (reading ? 'Reading point…' : searching ? 'Searching…' : query.trim() && !results.length ? 'No matching points.' : results.length === 100 ? 'Showing the first 100 matches. Refine your search to narrow the list.' : '')}</div>
		<TldrawUiButton type="normal" onClick={onCancel}><TldrawUiButtonLabel>Cancel</TldrawUiButtonLabel></TldrawUiButton>
	</div>
}
