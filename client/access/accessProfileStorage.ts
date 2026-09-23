import { getAccessProfile, type BasdrawAccessProfileId } from '../../shared/access.ts'

export const ACCESS_PROFILE_STORAGE_KEY = 'basdraw.access-profile.v1'

type ReadableStorage = Pick<Storage, 'getItem'>
type WritableStorage = Pick<Storage, 'setItem'>

/** Stored profile, falling back to the safe default when storage is missing, blocked or corrupted. */
export function readStoredAccessProfileId(storage: ReadableStorage | undefined = browserStorage()): BasdrawAccessProfileId {
	try { return getAccessProfile(storage?.getItem(ACCESS_PROFILE_STORAGE_KEY)).id }
	catch { return getAccessProfile(null).id }
}

/**
 * Applies a profile, then tries to remember it. State is updated first so a
 * storage failure (quota, private mode, blocked site data) can never keep the
 * user from switching to a stricter profile.
 */
export function selectAccessProfile(
	id: BasdrawAccessProfileId,
	apply: (id: BasdrawAccessProfileId) => void,
	storage: WritableStorage | undefined = browserStorage(),
) {
	const next = getAccessProfile(id).id
	apply(next)
	try { storage?.setItem(ACCESS_PROFILE_STORAGE_KEY, next) }
	catch { /* The choice still applies for this session. */ }
	return next
}

function browserStorage() {
	try { return typeof window === 'undefined' ? undefined : window.localStorage }
	catch { return undefined }
}
