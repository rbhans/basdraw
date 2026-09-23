import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import {
	getAccessProfile,
	type BasdrawAccessPolicy,
	type BasdrawAccessProfileId,
} from '../../shared/access'
import { readStoredAccessProfileId, selectAccessProfile } from './accessProfileStorage'

type AccessPolicyContextValue = {
	profileId: BasdrawAccessProfileId
	policy: BasdrawAccessPolicy
	setProfileId: (id: BasdrawAccessProfileId) => void
}

const AccessPolicyContext = createContext<AccessPolicyContextValue | null>(null)

export function AccessPolicyProvider({ children }: { children: ReactNode }) {
	const [profileId, setProfile] = useState<BasdrawAccessProfileId>(() => readStoredAccessProfileId())
	const value = useMemo<AccessPolicyContextValue>(() => ({
		profileId,
		policy: getAccessProfile(profileId).policy,
		setProfileId: (id) => { selectAccessProfile(id, setProfile) },
	}), [profileId])
	return <AccessPolicyContext.Provider value={value}>{children}</AccessPolicyContext.Provider>
}

export function useAccessPolicy() {
	const context = useContext(AccessPolicyContext)
	if (!context) throw new Error('AccessPolicyProvider is missing.')
	return context
}
