/**
 * A records diff, structurally compatible with tldraw's `RecordsDiff`.
 */
export interface RecordsDiffLike<R> {
	added: Record<string, R>
	updated: Record<string, [from: R, to: R]>
	removed: Record<string, R>
}

/**
 * Split a diff that is about to be applied into the part that can be applied safely and the
 * records that changed since the diff was captured (conflicts).
 *
 * A record can be applied when the canvas is still in the state the diff starts from:
 * - added: the record must not exist yet,
 * - updated [from, to]: the current record must equal `from`,
 * - removed: the current record must equal the removed record.
 *
 * Records that already match the diff's end state are skipped silently (nothing to do).
 * Anything else changed in the meantime (e.g. the user edited it) and is reported as a
 * conflict instead of being overwritten.
 */
export function partitionDiffByCurrentState<R>(
	diff: RecordsDiffLike<R>,
	getCurrent: (id: string) => R | undefined,
	isEqual: (a: R, b: R) => boolean
): { applicable: RecordsDiffLike<R>; conflicts: string[] } {
	const applicable: RecordsDiffLike<R> = { added: {}, updated: {}, removed: {} }
	const conflicts: string[] = []

	for (const [id, record] of Object.entries(diff.added)) {
		const current = getCurrent(id)
		if (current === undefined) applicable.added[id] = record
		else if (!isEqual(current, record)) conflicts.push(id)
	}

	for (const [id, [from, to]] of Object.entries(diff.updated)) {
		const current = getCurrent(id)
		if (current !== undefined && isEqual(current, from)) applicable.updated[id] = [from, to]
		else if (current === undefined || !isEqual(current, to)) conflicts.push(id)
	}

	for (const [id, record] of Object.entries(diff.removed)) {
		const current = getCurrent(id)
		if (current === undefined) continue
		if (isEqual(current, record)) applicable.removed[id] = record
		else conflicts.push(id)
	}

	return { applicable, conflicts }
}

/**
 * Reverse a diff (the equivalent of tldraw's `reverseRecordsDiff`).
 */
export function reverseDiff<R>(diff: RecordsDiffLike<R>): RecordsDiffLike<R> {
	const updated: Record<string, [R, R]> = {}
	for (const [id, [from, to]] of Object.entries(diff.updated)) updated[id] = [to, from]
	return { added: { ...diff.removed }, updated, removed: { ...diff.added } }
}
