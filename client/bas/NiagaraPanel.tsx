import { useEffect, useState, type KeyboardEvent } from 'react'
import { formatSnapshot } from './RuntimeBindingsOverlay'
import { PointTypeBadge } from './PointTypeBadge'
import { ContainerIcon } from './ContainerIcon'
import {
	isPointNode,
	nodeLabel,
	type ConnectionInput,
	type StationNode,
} from './types'
import type { BasWorkspace } from './useBasWorkspace'
import { pointReference } from './dataShapeSetup'
import { usePointDrag } from './PointDrag'

export function NiagaraPanel({ workspace }: { workspace: BasWorkspace }) {
	const [collapsed, setCollapsed] = useState(false)
	return <aside className={`niagara-panel ${collapsed ? 'is-collapsed' : ''}`} aria-label="Station points">
		<header className="station-panel-title"><strong>Points</strong><button type="button" aria-label={collapsed ? 'Expand points panel' : 'Collapse points panel'} aria-expanded={!collapsed} onClick={() => setCollapsed((value) => !value)}>{collapsed ? '+' : '−'}</button></header>
		<div className="station-panel-content" hidden={collapsed}>
			{workspace.status === 'connected' && workspace.connectedProfile ? <ConnectedPanel workspace={workspace} /> : <ConnectionForm workspace={workspace} />}
		</div>
	</aside>
}

function ConnectionForm({ workspace }: { workspace: BasWorkspace }) {
	const firstProfile = workspace.profiles.find((profile) => profile.alias === workspace.document.stationAlias) || workspace.profiles[0]
	const [form, setForm] = useState<ConnectionInput>(() => ({
		alias: firstProfile?.alias || workspace.document.stationAlias || 'local-station',
		name: firstProfile?.name || 'Local Niagara station',
		stationUrl: firstProfile?.stationUrl || '',
		username: firstProfile?.username || '',
		password: '',
		tlsMode: firstProfile?.tlsMode || 'strict',
		remember: true,
	}))
	const [testResult, setTestResult] = useState<string | null>(null)

	const setField = <K extends keyof ConnectionInput>(key: K, value: ConnectionInput[K]) => {
		setForm((current) => ({ ...current, [key]: value }))
	}

	const useProfile = (alias: string) => {
		const profile = workspace.profiles.find((candidate) => candidate.alias === alias)
		if (!profile) return
		setForm((current) => ({ ...profile, password: current.password, remember: true }))
		setTestResult(null)
	}

	const submit = async (testOnly = false) => {
		setTestResult(null)
		try {
			const capabilities = await workspace.connect(form)
			if (testOnly) {
				setTestResult(`Connection passed · API ${capabilities.apiVersion || 'not reported'}`)
				workspace.disconnect()
			}
		} catch {
			// The workspace exposes the bounded error message.
		}
	}

	return (
		<div className="connection-view">
			<div className="section-heading">
				<span className="eyebrow">Connection</span>
				<h2>Connect to baskStream</h2>
				<p>The password stays in memory for this browser session and is never saved in the canvas.</p>
			</div>

			{workspace.profiles.length > 0 && (
				<div className="saved-profiles">
					<label>Saved endpoint</label>
					<div className="profile-row">
						<select value={form.alias} onChange={(event) => useProfile(event.target.value)}>
							{workspace.profiles.map((profile) => <option key={profile.alias} value={profile.alias}>{profile.name}</option>)}
						</select>
						<button className="icon-button" type="button" title="Forget endpoint" onClick={() => workspace.removeProfile(form.alias)}>×</button>
					</div>
				</div>
			)}

			<form className="connection-form" onSubmit={(event) => { event.preventDefault(); void submit() }}>
				<label>
					<span>Friendly name</span>
					<input value={form.name} onChange={(event) => setField('name', event.target.value)} required />
				</label>
				<label>
					<span>Station alias</span>
					<input value={form.alias} onChange={(event) => setField('alias', slug(event.target.value))} required />
					<small>Saved with bindings so another operator can remap the same canvas.</small>
				</label>
				<label>
					<span>Station or baskStream URL</span>
					<input
						value={form.stationUrl}
						onChange={(event) => setField('stationUrl', event.target.value)}
						placeholder="https://station or wss://station/stream"
						required
					/>
				</label>
				<label>
					<span>Niagara user</span>
					<input value={form.username} onChange={(event) => setField('username', event.target.value)} autoComplete="username" required />
				</label>
				<label>
					<span>Password</span>
					<input type="password" value={form.password} onChange={(event) => setField('password', event.target.value)} autoComplete="current-password" required />
				</label>
				<label className="check-row">
					<input type="checkbox" checked={form.tlsMode === 'insecure'} onChange={(event) => setField('tlsMode', event.target.checked ? 'insecure' : 'strict')} />
					<span>Allow this station's self-signed certificate</span>
				</label>
				<label className="check-row">
					<input type="checkbox" checked={form.remember} onChange={(event) => setField('remember', event.target.checked)} />
					<span>Remember endpoint and user, never password</span>
				</label>
				{form.tlsMode === 'insecure' && <div className="inline-warning">TLS verification is disabled only for this station connection.</div>}
				{workspace.error && <div className="inline-error">{workspace.error}</div>}
				{testResult && <div className="inline-success">{testResult}</div>}
				<div className="button-row">
					<button className="secondary-button" type="button" disabled={workspace.status === 'connecting'} onClick={() => void submit(true)}>Test connection</button>
					<button className="primary-button" type="submit" disabled={workspace.status === 'connecting'}>{workspace.status === 'connecting' ? 'Connecting…' : 'Connect'}</button>
				</div>
			</form>
		</div>
	)
}

function ConnectedPanel({ workspace }: { workspace: BasWorkspace }) {
	const [rootOrd, setRootOrd] = useState('slot:/')
	const [children, setChildren] = useState<Record<string, StationNode[]>>({})
	const [expanded, setExpanded] = useState<Set<string>>(new Set())
	const [loading, setLoading] = useState<Set<string>>(new Set())
	const [treeError, setTreeError] = useState<string | null>(null)
	const [query, setQuery] = useState('')
	const [searchResults, setSearchResults] = useState<StationNode[] | null>(null)
	const [searching, setSearching] = useState(false)
	const load = async (ord: string) => {
		setTreeError(null)
		setLoading((current) => new Set(current).add(ord))
		try {
			const nodes = await workspace.browse(ord)
			setChildren((current) => ({ ...current, [ord]: nodes }))
		} catch (cause) {
			setTreeError(cause instanceof Error ? cause.message : String(cause))
		} finally {
			setLoading((current) => {
				const next = new Set(current)
				next.delete(ord)
				return next
			})
		}
	}

	useEffect(() => { void load(rootOrd) }, [rootOrd])

	useEffect(() => {
		const normalizedQuery = query.trim()
		if (!normalizedQuery) {
			setSearchResults(null)
			setSearching(false)
			return
		}

		let cancelled = false
		setSearching(true)
		const timeout = window.setTimeout(() => {
			setTreeError(null)
			void workspace.search(normalizedQuery, rootOrd)
				.then((nodes) => {
					if (!cancelled) setSearchResults(nodes)
				})
				.catch((cause) => {
					if (!cancelled) setTreeError(cause instanceof Error ? cause.message : String(cause))
				})
				.finally(() => {
					if (!cancelled) setSearching(false)
				})
		}, 180)

		return () => {
			cancelled = true
			window.clearTimeout(timeout)
		}
	}, [query, rootOrd, workspace.search])

	const selectPoint = async (node: StationNode) => {
		await workspace.setSelectedPoint(node)
	}

	const toggleNode = async (node: StationNode) => {
		if (isPointNode(node)) {
			await selectPoint(node)
			return
		}
		const browseOrd = nodeBrowseOrd(node)
		setExpanded((current) => {
			const next = new Set(current)
			if (next.has(browseOrd)) next.delete(browseOrd)
			else next.add(browseOrd)
			return next
		})
		if (!children[browseOrd]) await load(browseOrd)
	}

	const bindingPoint = workspace.selectedPoint
	const selectedPointRef = bindingPoint?.slotPath || bindingPoint?.ord
	const selectedSnapshot = selectedPointRef ? workspace.snapshots[selectedPointRef] : undefined
	const searchActive = query.trim().length > 0
	const visibleSearchResults = searchResults?.filter((node) => nodeMatchesQuery(node, query)) || []
	const selectedWidgetOrds = new Set<string>()

	return (
		<div className="connected-view">
			<div className="station-header">
				<div>
					<span className="connection-dot" />
					<strong>{workspace.connectedProfile?.name}</strong>
				</div>
				<button className="text-button" onClick={workspace.disconnect}>Disconnect</button>
			</div>
			<div className="station-contract">
				<span>baskStream {workspace.capabilities?.apiVersion || 'unknown'}</span>
				<span>{workspace.activePoints.length} live {workspace.activePoints.length === 1 ? 'point' : 'points'}</span>
			</div>
			{workspace.error && <div className="inline-error" role="status">{workspace.error}</div>}

			<div className="tree-toolbar">
				<div className="root-switcher">
					<button className={rootOrd === 'slot:/' ? 'active' : ''} onClick={() => { setRootOrd('slot:/'); setSearchResults(null) }}>Station</button>
					{workspace.capabilities?.policy?.hierarchyBrowse && <button className={rootOrd === 'hierarchy:' ? 'active' : ''} onClick={() => { setRootOrd('hierarchy:'); setSearchResults(null) }}>Hierarchy</button>}
				</div>
				<div className="tree-search">
					<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter points…" aria-label="Filter points" />
					{searchActive
						? <button type="button" title="Clear filter" aria-label="Clear filter" onClick={() => setQuery('')}>×</button>
						: <span className="tree-search-icon" aria-hidden="true">⌕</span>}
				</div>
			</div>

			<div className="station-tree" role="tree" aria-label="Niagara station browser" aria-multiselectable={false} onKeyDown={navigateTree}>
				{searchActive
					? visibleSearchResults.map((node) => <SearchRow key={node.ord} node={node} selected={bindingPoint?.ord === node.ord} multiSelect={false} onSelect={() => void selectPoint(node)} />)
					: <TreeBranch nodes={children[rootOrd] || []} depth={0} childrenByOrd={children} expanded={expanded} loading={loading} selectedOrd={bindingPoint?.ord} selectedWidgetOrds={selectedWidgetOrds} multiSelect={false} onToggle={toggleNode} />}
				{searchActive && searching && visibleSearchResults.length === 0 && <div className="empty-state">Filtering points…</div>}
				{searchActive && !searching && visibleSearchResults.length === 0 && <div className="empty-state">No readable points matched “{query.trim()}”.</div>}
				{searchActive && searchResults && searchResults.length >= 100 && <div className="empty-state">Showing up to 100 matches. Narrow the filter to find more specific points.</div>}
				{!searchActive && loading.has(rootOrd) && <div className="empty-state">Loading station tree…</div>}
				{treeError && <div className="tree-error">Could not {searchActive ? 'filter points' : 'open branch'}: {treeError}</div>}
			</div>

			<div className="point-inspector">
				<strong>Point inspector</strong>
				{bindingPoint ? <div className="selected-point-card">
					<div><strong>{nodeLabel(bindingPoint)}</strong><span>{selectedSnapshot ? formatSnapshot(selectedSnapshot) : 'Reading value…'}</span></div>
					<small>{selectedPointRef}</small>
				</div> : <p className="inspector-hint">Choose a point to inspect its value.</p>}
				<p className="inspector-hint">Drag a point onto a shape to add a behavior. To replace an existing driver, select the shape and use Change point in its behavior settings.</p>
			</div>
		</div>
	)
}

function TreeBranch({ nodes, depth, childrenByOrd, expanded, loading, selectedOrd, selectedWidgetOrds, multiSelect, onToggle }: {
	nodes: StationNode[]
	depth: number
	childrenByOrd: Record<string, StationNode[]>
	expanded: Set<string>
	loading: Set<string>
	selectedOrd?: string
	selectedWidgetOrds: Set<string>
	multiSelect: boolean
	onToggle: (node: StationNode) => void
}) {
	const drag = usePointDrag()
	return <>{nodes.map((node) => {
		const point = isPointNode(node)
		const key = nodeBrowseOrd(node)
		const open = expanded.has(key)
		return (
			<div key={key}>
				<button
					className={`tree-row ${point ? 'point' : 'container'} ${(multiSelect && point ? selectedWidgetOrds.has(pointReference(node)) : selectedOrd === node.ord) ? 'selected' : ''}`}
					style={{ paddingLeft: 10 + depth * 14 }}
					onClick={() => void onToggle(node)}
					role="treeitem"
					draggable={point}
					onDragStart={(event) => point && drag.begin(event, node)}
					onDragEnd={drag.end}
					aria-level={depth + 1}
					aria-selected={multiSelect && point ? selectedWidgetOrds.has(pointReference(node)) : selectedOrd === node.ord}
					aria-expanded={point ? undefined : open}
				>
					<span className={`tree-chevron ${multiSelect && point ? 'multi' : ''}`}>{point ? multiSelect ? selectedWidgetOrds.has(pointReference(node)) ? '✓' : '+' : '' : loading.has(key) ? '·' : open ? '⌄' : '›'}</span>
					{point ? <PointTypeBadge node={node} /> : <ContainerIcon node={node} />}
					<span>{nodeLabel(node)}</span>
					{node.ok === false && <span className="node-alert">!</span>}
				</button>
				{open && <TreeBranch nodes={childrenByOrd[key] || []} depth={depth + 1} childrenByOrd={childrenByOrd} expanded={expanded} loading={loading} selectedOrd={selectedOrd} selectedWidgetOrds={selectedWidgetOrds} multiSelect={multiSelect} onToggle={onToggle} />}
			</div>
		)
	})}</>
}

function SearchRow({ node, selected, multiSelect, onSelect }: { node: StationNode; selected: boolean; multiSelect: boolean; onSelect: () => void }) {
	const drag = usePointDrag()
	return (
		<button className={`search-row ${selected ? 'selected' : ''}`} role="treeitem" aria-level={1} aria-selected={selected} onClick={onSelect} draggable onDragStart={(event) => drag.begin(event, node)} onDragEnd={drag.end}>
			{multiSelect && <span className="search-row-check">{selected ? '✓' : '+'}</span>}
			<strong className="point-search-label"><PointTypeBadge node={node} />{nodeLabel(node)}</strong>
			<span>{node.slotPath || node.ord}</span>
		</button>
	)
}

function slug(value: string) {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function navigateTree(event: KeyboardEvent<HTMLDivElement>) {
	const keys = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End']
	if (!keys.includes(event.key)) return
	const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="treeitem"]'))
	const current = (event.target as HTMLElement).closest<HTMLButtonElement>('[role="treeitem"]')
	if (!current) return
	event.preventDefault()
	const index = items.indexOf(current)
	if (event.key === 'Home') items[0]?.focus()
	if (event.key === 'End') items.at(-1)?.focus()
	if (event.key === 'ArrowDown') items[Math.min(index + 1, items.length - 1)]?.focus()
	if (event.key === 'ArrowUp') items[Math.max(index - 1, 0)]?.focus()
	if (event.key === 'ArrowRight') {
		if (current.getAttribute('aria-expanded') === 'false') current.click()
		else if (current.getAttribute('aria-expanded') === 'true') items[index + 1]?.focus()
	}
	if (event.key === 'ArrowLeft') {
		if (current.getAttribute('aria-expanded') === 'true') current.click()
		else {
			const level = Number(current.getAttribute('aria-level'))
			items.slice(0, index).reverse().find((item) => Number(item.getAttribute('aria-level')) < level)?.focus()
		}
	}
}

function nodeBrowseOrd(node: StationNode) {
	return node.slotPath || node.ord
}

function nodeMatchesQuery(node: StationNode, query: string) {
	const normalizedQuery = query.trim().toLowerCase()
	if (!normalizedQuery) return true
	return [node.display, node.name, node.slotPath, node.ord]
		.some((value) => value?.toLowerCase().includes(normalizedQuery))
}
