import { useEffect, useState } from 'react'
import {
	TldrawUiButton, TldrawUiButtonLabel, TldrawUiDialogHeader, TldrawUiDialogTitle,
	TldrawUiDialogCloseButton, TldrawUiDialogBody, TldrawUiDialogFooter, TldrawUiInput,
	useDialogs, useEditor, type TLUiDialogProps,
} from 'tldraw'
import type { KnowledgeEntry, KnowledgeEntrySummary } from '../../shared/knowledge'
import { getProjectId } from './currentKnowledgeScope'

export function ProjectKnowledgeButton() {
	const { addDialog } = useDialogs()
	return <TldrawUiButton type="normal" onClick={() => addDialog({ id: 'project-knowledge', component: ProjectKnowledgeDialog })}>
		<TldrawUiButtonLabel>Project knowledge</TldrawUiButtonLabel>
	</TldrawUiButton>
}

const emptyDraft = { title: '', description: '', content: '', kind: 'reference' as 'reference' | 'skill', enabled: true }

function ProjectKnowledgeDialog({ onClose }: TLUiDialogProps) {
	const editor = useEditor()
	const [projectId, setProjectId] = useState(() => getProjectId(editor))
	const [projectInput, setProjectInput] = useState(projectId)
	const [entries, setEntries] = useState<KnowledgeEntrySummary[]>([])
	const [nextCursor, setNextCursor] = useState<string | null>(null)
	const [loadingMore, setLoadingMore] = useState(false)
	const [draft, setDraft] = useState(emptyDraft)
	const [selectedId, setSelectedId] = useState<string | null>(null)
	const [error, setError] = useState('')
	const [notice, setNotice] = useState('')
	const [busy, setBusy] = useState(false)
	const [loading, setLoading] = useState(true)
	const [revision, setRevision] = useState(0)
	const [dirty, setDirty] = useState(false)
	useEffect(() => {
		const controller = new AbortController()
		setLoading(true); setError(''); setEntries([]); setNextCursor(null)
		void fetch(listUrl(projectId), { signal: controller.signal })
			.then(readList).then((data) => { setEntries(data.entries); setNextCursor(data.nextCursor) })
			.catch((cause) => { if (!controller.signal.aborted) setError(String(cause.message || cause)) })
			.finally(() => { if (!controller.signal.aborted) setLoading(false) })
		return () => controller.abort()
	}, [projectId, revision])

	async function loadMore() {
		if (!nextCursor) return
		setLoadingMore(true); setError('')
		try {
			const data = await readList(await fetch(listUrl(projectId, nextCursor)))
			setEntries((current) => [...current, ...data.entries.filter((entry) => !current.some((item) => item.id === entry.id))])
			setNextCursor(data.nextCursor)
		} catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
		finally { setLoadingMore(false) }
	}
	function show(entry?: KnowledgeEntry) {
		setSelectedId(entry?.id ?? null)
		setDraft(entry ? { title: entry.title, description: entry.description, content: entry.content, kind: entry.kind, enabled: entry.enabled } : emptyDraft)
		setDirty(false); setNotice(''); setError('')
	}
	/** The list holds metadata only; the body is fetched when an entry is opened. */
	async function choose(summary?: KnowledgeEntrySummary) {
		if (!summary) return show()
		setBusy(true); setError('')
		try { show((await readResponse(await fetch(`/api/knowledge/${encodeURIComponent(summary.id)}`))).entry) }
		catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
		finally { setBusy(false) }
	}
	function patch(values: Partial<typeof draft>) { setDraft((current) => ({ ...current, ...values })); setDirty(true); setNotice('') }
	async function save() {
		setBusy(true); setError(''); setNotice('')
		try {
			const data = await readResponse(await fetch(selectedId ? `/api/knowledge/${encodeURIComponent(selectedId)}` : '/api/knowledge', {
				method: selectedId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ...draft, scopeType: 'project', scopeId: projectId }),
			}))
			setSelectedId(data.entry.id); setDirty(false); setNotice(draft.enabled ? 'Saved. Available to the agent on its next request.' : 'Saved. This entry is disabled.'); setRevision((value) => value + 1)
		} catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
		finally { setBusy(false) }
	}
	function switchProject() {
		const id = projectInput.trim()
		if (!id || id === projectId) return
		const document = editor.getDocumentSettings()
		editor.updateDocumentSettings({ meta: { ...document.meta, basdrawProjectId: id } })
		setProjectId(id); show()
	}
	return <div className="project-knowledge-dialog">
		<TldrawUiDialogHeader><TldrawUiDialogTitle>Project knowledge</TldrawUiDialogTitle><TldrawUiDialogCloseButton /></TldrawUiDialogHeader>
		<TldrawUiDialogBody>
			<p>Notes, references and procedures the agent can find when working on this project. Connection skills come with their add-ons.</p>
			<div className="project-knowledge-layout">
				<nav aria-label="Project knowledge entries">
					<TldrawUiButton type="normal" disabled={busy || dirty} onClick={() => show()}><TldrawUiButtonLabel>New entry</TldrawUiButtonLabel></TldrawUiButton>
					{loading && <p role="status">Loading…</p>}
					{!loading && entries.length === 0 && <p>No project knowledge yet.</p>}
					{entries.map((entry) => <TldrawUiButton key={entry.id} type="normal" disabled={busy || dirty} isActive={entry.id === selectedId} onClick={() => void choose(entry)}>
						<TldrawUiButtonLabel>{entry.title}{entry.enabled ? '' : ' (off)'}</TldrawUiButtonLabel>
					</TldrawUiButton>)}
					{nextCursor && <TldrawUiButton type="low" disabled={busy || loadingMore} onClick={() => void loadMore()}>
						<TldrawUiButtonLabel>{loadingMore ? 'Loading…' : 'Load more'}</TldrawUiButtonLabel>
					</TldrawUiButton>}
				</nav>
				<div className="project-knowledge-form">
					<label className="binding-field"><span>Title</span><TldrawUiInput value={draft.title} onValueChange={(title) => patch({ title })} placeholder="AHU naming conventions" aria-label="Knowledge title" disabled={busy} /></label>
					<label className="binding-field"><span>Type</span><select value={draft.kind} disabled={busy} onChange={(event) => patch({ kind: event.target.value as typeof draft.kind })}><option value="reference">Reference or project notes</option><option value="skill">Procedure / skill</option></select></label>
					<label className="binding-field"><span>When should the agent use this?</span><TldrawUiInput value={draft.description} onValueChange={(description) => patch({ description })} placeholder="When matching drawing labels to station points" aria-label="Knowledge description" disabled={busy} /></label>
					<label className="binding-field"><span>Content</span><textarea value={draft.content} disabled={busy} onChange={(event) => patch({ content: event.target.value })} placeholder="Add project facts, reference text or steps…" rows={10} maxLength={draft.kind === 'skill' ? 12000 : 100000} /></label>
					<label className="bas-native-check"><input type="checkbox" checked={draft.enabled} disabled={busy} onChange={(event) => patch({ enabled: event.target.checked })} />Available to the agent</label>
					{dirty && <small>Save or discard your edits before selecting another entry.</small>}
				</div>
			</div>
			<details><summary>Project identity</summary><p>This identity travels with the canvas file. Use the same identity to share knowledge between canvases, or a different one for a separate project. Existing entries stay with their original project.</p>
				<div className="project-knowledge-identity"><TldrawUiInput value={projectInput} onValueChange={setProjectInput} aria-label="Project identity" disabled={busy || dirty} /><TldrawUiButton type="normal" disabled={busy || dirty || !projectInput.trim() || projectInput.trim().length > 200 || projectInput.trim() === projectId} onClick={switchProject}><TldrawUiButtonLabel>Use project</TldrawUiButtonLabel></TldrawUiButton></div>
			</details>
			{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
		</TldrawUiDialogBody>
		<TldrawUiDialogFooter>
			{dirty && <TldrawUiButton type="normal" disabled={busy} onClick={() => void choose(entries.find((entry) => entry.id === selectedId))}><TldrawUiButtonLabel>Discard edits</TldrawUiButtonLabel></TldrawUiButton>}
			<TldrawUiButton type="normal" onClick={onClose}><TldrawUiButtonLabel>Close</TldrawUiButtonLabel></TldrawUiButton>
			<TldrawUiButton type="primary" disabled={busy || loading || !dirty || !draft.title.trim() || !draft.content.trim()} onClick={() => void save()}><TldrawUiButtonLabel>{busy ? 'Saving…' : 'Save'}</TldrawUiButtonLabel></TldrawUiButton>
		</TldrawUiDialogFooter>
	</div>
}

function listUrl(projectId: string, cursor?: string) {
	return `/api/knowledge?scopeType=project&scopeId=${encodeURIComponent(projectId)}&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
}

async function readList(response: Response): Promise<{ entries: KnowledgeEntrySummary[]; nextCursor: string | null }> {
	const data = await response.json() as { entries: KnowledgeEntrySummary[]; nextCursor?: string | null; error?: string }
	if (!response.ok) throw new Error(data.error || 'Could not load project knowledge.')
	return { entries: data.entries, nextCursor: data.nextCursor ?? null }
}

async function readResponse(response: Response): Promise<{ entry: KnowledgeEntry }> {
	const data = await response.json() as { entry: KnowledgeEntry; error?: string }
	if (!response.ok) throw new Error(data.error || 'Could not load project knowledge.')
	return data
}
