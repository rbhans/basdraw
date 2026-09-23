import { useCallback, useMemo } from 'react'
import {
	isEqual,
	RecordsDiff,
	reverseRecordsDiff,
	squashRecordDiffs,
	TLRecord,
	useToasts,
	useValue,
} from 'tldraw'
import { AgentIcon, AgentIconType } from '../../../shared/icons/AgentIcon'
import { ChatHistoryActionItem } from '../../../shared/types/ChatHistoryItem'
import { useAccessPolicy } from '../../access/AccessPolicyContext'
import { useAgent } from '../../agent/TldrawAgentAppProvider'
import { ChatHistoryGroup } from './ChatHistoryGroup'
import { partitionDiffByCurrentState } from './diffConflicts'
import { getActionInfo } from './getActionInfo'
import { TldrawDiffViewer } from './TldrawDiffViewer'

export function ChatHistoryGroupWithDiff({ group }: { group: ChatHistoryGroup }) {
	const agent = useAgent()
	const { items } = group
	const { editor } = agent
	const toasts = useToasts()
	const { policy } = useAccessPolicy()
	const diff = useMemo(() => squashRecordDiffs(items.map((item) => item.diff)), [items])

	// Accepting or rejecting writes to the canvas, so it's only possible when the canvas is editable
	const isReadonly = useValue('isReadonly', () => editor.getIsReadonly(), [editor])
	const canWrite = !isReadonly && policy.canvas === 'write'
	const isReviewable = !items.some((item) => item.diffOmitted)
	const disabledReason = !isReviewable
		? 'This change is too old to review.'
		: !canWrite
			? 'The canvas is read-only.'
			: undefined

	/**
	 * Apply diffs to the canvas, skipping records that changed since the diffs were captured.
	 * Returns the number of skipped records.
	 */
	const applyDiffsSafely = useCallback(
		(diffs: RecordsDiff<TLRecord>[]) => {
			let conflicts = 0
			editor.run(() => {
				for (const nextDiff of diffs) {
					const partition = partitionDiffByCurrentState<TLRecord>(
						nextDiff,
						(id) => editor.store.get(id as TLRecord['id']),
						(a, b) => isEqual(a, b)
					)
					conflicts += partition.conflicts.length
					editor.store.applyDiff(partition.applicable as RecordsDiff<TLRecord>)
				}
			})
			if (conflicts > 0) {
				toasts.addToast({
					title: 'Some changes were kept',
					description: `${conflicts} item(s) changed after Canvas AI edited them, so they were left as they are.`,
					severity: 'warning',
				})
			}
		},
		[editor, toasts]
	)

	const setAcceptance = useCallback(
		(acceptance: ChatHistoryActionItem['acceptance']) => {
			agent.chat.update((currentChatHistoryItems) => {
				const newItems = [...currentChatHistoryItems]
				for (const item of items) {
					const index = newItems.findIndex((v) => v === item)
					if (index !== -1) {
						newItems[index] = { ...item, acceptance }
					}
				}
				return newItems
			})
		},
		[items, agent.chat]
	)

	// Accept all changes from this group
	const handleAccept = useCallback(() => {
		if (!canWrite || !isReviewable) return
		// Re-apply the diffs of rejected items, in order
		applyDiffsSafely(items.filter((item) => item.acceptance === 'rejected').map((item) => item.diff))
		setAcceptance('accepted')
	}, [items, canWrite, isReviewable, applyDiffsSafely, setAcceptance])

	// Reject all changes from this group
	const handleReject = useCallback(() => {
		if (!canWrite || !isReviewable) return
		// Reverse the diffs of items that aren't rejected yet, newest first
		applyDiffsSafely(
			items
				.filter((item) => item.acceptance !== 'rejected')
				.reverse()
				.map((item) => reverseRecordsDiff(item.diff))
		)
		setAcceptance('rejected')
	}, [items, canWrite, isReviewable, applyDiffsSafely, setAcceptance])

	// Get the acceptance status of the group
	// If all items are accepted, the group is accepted
	// If all items are rejected, the group is rejected
	// Otherwise, the group is pending
	const acceptance = useMemo<ChatHistoryActionItem['acceptance']>(() => {
		if (items.length === 0) return 'pending'
		const acceptance = items[0].acceptance
		for (let i = 1; i < items.length; i++) {
			if (items[i].acceptance !== acceptance) {
				return 'pending'
			}
		}
		return acceptance
	}, [items])

	const steps = useMemo(
		() => items.map((item) => getActionInfo(item.action, agent)),
		[items, agent]
	)

	return (
		<div className="chat-history-change">
			<div className="chat-history-change-acceptance">
				<button
					onClick={handleReject}
					disabled={acceptance === 'rejected' || !!disabledReason}
					title={acceptance === 'rejected' ? undefined : disabledReason}
				>
					{acceptance === 'rejected' ? 'Rejected' : 'Reject'}
				</button>
				<button
					onClick={handleAccept}
					disabled={acceptance === 'accepted' || !!disabledReason}
					title={acceptance === 'accepted' ? undefined : disabledReason}
				>
					{acceptance === 'accepted' ? 'Accepted' : 'Accept'}
				</button>
			</div>
			<DiffSteps steps={steps} />
			<TldrawDiffViewer diff={diff} />
		</div>
	)
}

interface DiffStep {
	icon: AgentIconType | null
	description: string | null
}

function DiffSteps({ steps }: { steps: DiffStep[] }) {
	let previousDescription = ''
	return (
		<div className="agent-changes">
			{steps.map((step, i) => {
				if (!step.description) return null

				if (step.description === previousDescription) return null
				previousDescription = step.description
				return (
					<div className="agent-change" key={'intent-' + i}>
						{step.icon && (
							<span className="agent-change-icon">
								<AgentIcon type={step.icon} />
							</span>
						)}
						{step.description}
					</div>
				)
			})}
		</div>
	)
}
