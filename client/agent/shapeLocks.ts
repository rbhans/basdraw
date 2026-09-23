/**
 * Lock rules for agent mutations.
 *
 * The agent runs its edits with `ignoreShapeLock: true` because the starter kit locks
 * shapes while they stream in (see CreateActionUtil / PenActionUtil). That flag must not
 * let the agent modify shapes the *user* locked, such as vector-PDF underlays or document
 * images, or anything inside a locked frame. These helpers are dependency-free so they
 * can be unit tested.
 */

export interface LockNode {
	id: string
	parentId: string
	isLocked: boolean
}

export type GetLockNode = (id: string) => LockNode | undefined

/**
 * Find the locked shape (the shape itself or one of its ancestors) that protects a shape
 * from agent mutation. Shapes the agent created during the current prompt chain are its
 * own streaming locks and never count.
 *
 * @returns The id of the protecting locked shape, or null if the shape can be modified.
 */
export function getProtectingLockId(
	id: string,
	getNode: GetLockNode,
	agentCreatedIds: ReadonlySet<string>
): string | null {
	const visited = new Set<string>()
	let node = getNode(id)
	while (node && !visited.has(node.id)) {
		visited.add(node.id)
		if (node.isLocked && !agentCreatedIds.has(node.id)) return node.id
		node = getNode(node.parentId)
	}
	return null
}

/**
 * Whether a shape has a protected (user-locked) descendant. Deleting such a shape would
 * delete the locked descendant along with it.
 */
export function hasProtectedDescendant(
	id: string,
	getNode: GetLockNode,
	getChildIds: (id: string) => readonly string[],
	agentCreatedIds: ReadonlySet<string>
): boolean {
	const stack = [...getChildIds(id)]
	const visited = new Set<string>()
	while (stack.length > 0) {
		const childId = stack.pop()!
		if (visited.has(childId)) continue
		visited.add(childId)
		const node = getNode(childId)
		if (node?.isLocked && !agentCreatedIds.has(childId)) return true
		stack.push(...getChildIds(childId))
	}
	return false
}

/**
 * Split shape ids into those the agent may mutate and those protected by a user lock.
 */
export function partitionByLock(
	ids: readonly string[],
	getNode: GetLockNode,
	agentCreatedIds: ReadonlySet<string>,
	getChildIds?: (id: string) => readonly string[]
): { allowed: string[]; protected: string[] } {
	const allowed: string[] = []
	const protectedIds: string[] = []
	for (const id of ids) {
		const locked =
			getProtectingLockId(id, getNode, agentCreatedIds) !== null ||
			(getChildIds ? hasProtectedDescendant(id, getNode, getChildIds, agentCreatedIds) : false)
		if (locked) protectedIds.push(id)
		else allowed.push(id)
	}
	return { allowed, protected: protectedIds }
}
