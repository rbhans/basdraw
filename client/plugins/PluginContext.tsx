import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { pluginRegistry } from './builtinPlugins'
import type { BasdrawPlugin, BasdrawPluginPreferences } from './types'

const STORAGE_KEY = 'basdraw.plugin-preferences.v1'
const EMPTY_PREFERENCES: BasdrawPluginPreferences = { disabled: [], enabled: [] }

type PluginContextValue = {
	installed: readonly BasdrawPlugin[]
	enabled: readonly BasdrawPlugin[]
	isEnabled: (id: string) => boolean
	setEnabled: (id: string, enabled: boolean) => void
}

const PluginContext = createContext<PluginContextValue | null>(null)

export function BasdrawPluginProvider({ children }: { children: ReactNode }) {
	const [preferences, setPreferences] = useState<BasdrawPluginPreferences>(readPreferences)
	const loaded = useRef(preferences)
	// Persist outside the state updater (updaters must stay pure); storage failure is non-fatal.
	useEffect(() => {
		if (preferences === loaded.current) return
		try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)) }
		catch (error) { console.warn('[basdraw] Add-on preferences could not be saved; they apply for this session only.', error) }
	}, [preferences])
	const enabled = useMemo(() => pluginRegistry.resolveEnabled(preferences), [preferences])
	const enabledIds = useMemo(() => new Set(enabled.map((plugin) => plugin.id)), [enabled])
	const value = useMemo<PluginContextValue>(() => ({
		installed: pluginRegistry.plugins,
		enabled,
		isEnabled: (id) => enabledIds.has(id),
		setEnabled: (id, next) => setPreferences((current) => {
			const plugin = pluginRegistry.get(id)
			if (!plugin || plugin.alwaysEnabled) return current
			const disabled = new Set(current.disabled), explicitlyEnabled = new Set(current.enabled)
			if (next) {
				const enableWithDependencies = (pluginId: string) => {
					disabled.delete(pluginId)
					explicitlyEnabled.add(pluginId)
					for (const dependency of pluginRegistry.get(pluginId)?.dependencies ?? []) enableWithDependencies(dependency)
				}
				enableWithDependencies(id)
			}
			else { disabled.add(id); explicitlyEnabled.delete(id) }
			return { disabled: [...disabled], enabled: [...explicitlyEnabled] }
		}),
	}), [enabled, enabledIds])
	return <PluginContext.Provider value={value}>{children}</PluginContext.Provider>
}

/** For components that also render outside the plugin provider, such as QA harnesses. */
export function useOptionalBasdrawPlugins() {
	return useContext(PluginContext)
}

export function useBasdrawPlugins() {
	const context = useContext(PluginContext)
	if (!context) throw new Error('BasdrawPluginProvider is missing.')
	return context
}

function readPreferences(): BasdrawPluginPreferences {
	try {
		const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null') as Partial<BasdrawPluginPreferences> | null
		return { disabled: stringList(parsed?.disabled), enabled: stringList(parsed?.enabled) }
	} catch { return EMPTY_PREFERENCES }
}

function stringList(value: unknown) {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}
