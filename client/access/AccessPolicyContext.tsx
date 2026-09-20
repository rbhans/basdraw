import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import {
	BASDRAW_ACCESS_PROFILES,
	getAccessProfile,
	type BasdrawAccessPolicy,
	type BasdrawAccessProfileId,
} from '../../shared/access'

const STORAGE_KEY = 'basdraw.access-profile.v1'

type AccessPolicyContextValue = {
	profileId: BasdrawAccessProfileId
	policy: BasdrawAccessPolicy
	setProfileId: (id: BasdrawAccessProfileId) => void
}

const AccessPolicyContext = createContext<AccessPolicyContextValue | null>(null)

export function AccessPolicyProvider({ children }: { children: ReactNode }) {
	const [profileId, setProfile] = useState<BasdrawAccessProfileId>(() => {
		try { return getAccessProfile(window.localStorage.getItem(STORAGE_KEY)).id }
		catch { return BASDRAW_ACCESS_PROFILES[0].id }
	})
	const value = useMemo<AccessPolicyContextValue>(() => ({
		profileId,
		policy: getAccessProfile(profileId).policy,
		setProfileId: (id) => {
			const next = getAccessProfile(id).id
			window.localStorage.setItem(STORAGE_KEY, next)
			setProfile(next)
		},
	}), [profileId])
	return <AccessPolicyContext.Provider value={value}>{children}</AccessPolicyContext.Provider>
}

export function useAccessPolicy() {
	const context = useContext(AccessPolicyContext)
	if (!context) throw new Error('AccessPolicyProvider is missing.')
	return context
}
