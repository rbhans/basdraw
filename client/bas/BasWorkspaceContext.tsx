import { createContext, useContext, type ReactNode } from 'react'
import type { BasWorkspace } from './useBasWorkspace'

const WorkspaceContext = createContext<BasWorkspace | null>(null)

export function BasWorkspaceProvider({ workspace, children }: { workspace: BasWorkspace; children: ReactNode }) {
	return <WorkspaceContext.Provider value={workspace}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace() {
	const workspace = useContext(WorkspaceContext)
	if (!workspace) throw new Error('A BAS workspace is required for the behavior inspector.')
	return workspace
}
