import type { TLAnyBindingUtilConstructor, TLAnyShapeUtilConstructor, TLOverlayUtilConstructor, TLStateNodeConstructor } from 'tldraw'
import type {
	BasdrawDocumentPluginRequirement,
	BasdrawPlugin,
	BasdrawPluginCategory,
	BasdrawPluginPreferences,
	BasdrawPropertySection,
	BasdrawToolbarGroup,
	BasdrawToolbarItem,
} from './types'

export class BasdrawPluginRegistry {
	readonly plugins: readonly BasdrawPlugin[]
	private readonly byId: ReadonlyMap<string, BasdrawPlugin>

	constructor(plugins: readonly BasdrawPlugin[]) {
		this.plugins = [...plugins]
		this.byId = new Map(plugins.map((plugin) => [plugin.id, plugin]))
		this.validate()
	}

	get(id: string) { return this.byId.get(id) }

	categories() {
		const groups = new Map<string, { category: BasdrawPluginCategory; plugins: BasdrawPlugin[] }>()
		for (const plugin of this.plugins) {
			if (plugin.alwaysEnabled) continue
			const entry = groups.get(plugin.category.id) ?? { category: plugin.category, plugins: [] }
			entry.plugins.push(plugin)
			groups.set(plugin.category.id, entry)
		}
		return [...groups.values()].sort((a, b) => a.category.order - b.category.order)
	}

	resolveEnabled(preferences: BasdrawPluginPreferences): readonly BasdrawPlugin[] {
		const disabled = new Set(preferences.disabled)
		const explicitlyEnabled = new Set(preferences.enabled)
		const enabled = new Set(this.plugins.filter((plugin) => plugin.alwaysEnabled || (plugin.defaultEnabled !== false && !disabled.has(plugin.id)) || explicitlyEnabled.has(plugin.id)).map((plugin) => plugin.id))
		let changed = true
		while (changed) {
			changed = false
			for (const id of [...enabled]) {
				const plugin = this.byId.get(id)!
				if (plugin.alwaysEnabled) continue
				if ((plugin.dependencies ?? []).some((dependency) => !enabled.has(dependency))) {
					enabled.delete(id)
					changed = true
				}
			}
		}
		return this.plugins.filter((plugin) => enabled.has(plugin.id))
	}

	shapeUtils(): TLAnyShapeUtilConstructor[] { return this.uniqueConstructors('shape', this.plugins.flatMap((plugin) => plugin.tldraw?.shapeUtils ?? [])) }
	bindingUtils(): TLAnyBindingUtilConstructor[] { return this.uniqueConstructors('binding', this.plugins.flatMap((plugin) => plugin.tldraw?.bindingUtils ?? [])) }
	tools(): TLStateNodeConstructor[] { return this.uniqueConstructors('tool', this.plugins.flatMap((plugin) => plugin.tldraw?.tools ?? [])) }
	overlayUtils(): TLOverlayUtilConstructor[] { return this.uniqueConstructors('overlay', this.plugins.flatMap((plugin) => plugin.tldraw?.overlayUtils ?? [])) }

	translations(plugins: readonly BasdrawPlugin[] = this.plugins) {
		return Object.assign({}, ...plugins.map((plugin) => plugin.tldraw?.translations ?? {})) as Record<string, string>
	}

	uiTools(plugins: readonly BasdrawPlugin[] = this.plugins) {
		return plugins.flatMap((plugin) => plugin.tldraw?.uiTools ?? [])
	}

	toolbarGroups(plugins: readonly BasdrawPlugin[]): { group: BasdrawToolbarGroup; items: BasdrawToolbarItem[] }[] {
		const groups = new Map<string, { group: BasdrawToolbarGroup; items: BasdrawToolbarItem[] }>()
		for (const item of plugins.flatMap((plugin) => plugin.toolbarItems ?? [])) {
			const entry = groups.get(item.group.id) ?? { group: item.group, items: [] }
			entry.items.push(item)
			groups.set(item.group.id, entry)
		}
		return [...groups.values()]
			.map((entry) => ({ ...entry, items: entry.items.sort((a, b) => a.order - b.order) }))
			.sort((a, b) => a.group.order - b.group.order)
	}

	propertySections(plugins: readonly BasdrawPlugin[]): BasdrawPropertySection[] {
		return plugins.flatMap((plugin) => plugin.propertySections ?? []).sort((a, b) => a.order - b.order)
	}

	documentRequirements(plugins: readonly BasdrawPlugin[]): BasdrawDocumentPluginRequirement[] {
		return plugins.map(({ id, version }) => ({ id, version }))
	}

	private validate() {
		if (this.byId.size !== this.plugins.length) throw new Error('Basdraw plugin ids must be unique.')
		const categories = new Map<string, BasdrawPluginCategory>()
		for (const plugin of this.plugins) {
			const category = plugin.category
			if (plugin.knowledge && plugin.knowledge.pluginId !== plugin.id) throw new Error(`Knowledge bundle ownership must match ${plugin.id}.`)
			if (!category || !/^[a-z][a-z0-9-]*$/.test(category.id) || !category.label.trim() || !Number.isFinite(category.order)) {
				throw new Error(`Plugin ${plugin.id} must declare a valid category.`)
			}
			const existing = categories.get(category.id)
			if (existing && (existing.label !== category.label || existing.order !== category.order)) {
				throw new Error(`Conflicting metadata for plugin category ${category.id}.`)
			}
			categories.set(category.id, category)
			if (!/^[a-z][a-z0-9-]*$/.test(plugin.id)) throw new Error(`Invalid basdraw plugin id: ${plugin.id}`)
			if (!/^\d+\.\d+\.\d+/.test(plugin.version)) throw new Error(`Plugin ${plugin.id} must use a version such as 1.0.0.`)
			for (const dependency of plugin.dependencies ?? []) {
				if (!this.byId.has(dependency)) throw new Error(`Plugin ${plugin.id} requires missing plugin ${dependency}.`)
			}
		}
		this.assertNoDependencyCycles()
		this.assertUniqueIds('knowledge entry', this.plugins.flatMap((plugin) => plugin.knowledge?.entries.map((entry) => entry.id) ?? []))
		this.assertUniqueIds('toolbar item', this.plugins.flatMap((plugin) => plugin.toolbarItems?.map((item) => item.id) ?? []))
		this.assertUniqueIds('UI tool', this.plugins.flatMap((plugin) => plugin.tldraw?.uiTools?.map((tool) => tool.id) ?? []))
		this.assertUniqueIds('property section', this.plugins.flatMap((plugin) => plugin.propertySections?.map((section) => section.id) ?? []))
		this.assertUniqueIds('canvas overlay', this.plugins.flatMap((plugin) => plugin.canvasOverlays?.map((overlay) => overlay.id) ?? []))
		this.assertUniqueIds('shape decorator', this.plugins.flatMap((plugin) => plugin.shapeDecorators?.map((decorator) => decorator.id) ?? []))
		this.assertUniqueIds('provider', this.plugins.flatMap((plugin) => plugin.providers?.map((provider) => provider.id) ?? []))
		this.assertUniqueIds('app panel', this.plugins.flatMap((plugin) => plugin.appPanels?.map((panel) => panel.id) ?? []))
		this.assertUniqueIds('agent canvas capability', this.plugins.flatMap((plugin) => plugin.agent?.canvasCapabilities?.map((capability) => `${plugin.id}:${capability.id}`) ?? []))
		for (const plugin of this.plugins) {
			for (const capability of plugin.agent?.canvasCapabilities ?? []) {
				if (!/^[a-z][a-z0-9-]*$/.test(capability.id) || !capability.title.trim() || !capability.description.trim() || capability.operations.length === 0) {
					throw new Error(`Plugin ${plugin.id} has an invalid agent canvas capability.`)
				}
			}
		}
		this.shapeUtils()
		this.bindingUtils()
		this.tools()
		this.overlayUtils()
	}

	private assertNoDependencyCycles() {
		const visiting = new Set<string>(), visited = new Set<string>()
		const visit = (id: string) => {
			if (visiting.has(id)) throw new Error(`Basdraw plugin dependency cycle includes ${id}.`)
			if (visited.has(id)) return
			visiting.add(id)
			for (const dependency of this.byId.get(id)?.dependencies ?? []) visit(dependency)
			visiting.delete(id); visited.add(id)
		}
		for (const plugin of this.plugins) visit(plugin.id)
	}

	private assertUniqueIds(kind: string, ids: string[]) {
		if (new Set(ids).size !== ids.length) throw new Error(`Basdraw ${kind} ids must be unique.`)
	}

	private uniqueConstructors<T extends { type?: string; id?: string }>(kind: string, constructors: readonly T[]): T[] {
		const seen = new Set<string>()
		for (const constructor of constructors) {
			const id = constructor.type ?? constructor.id
			if (!id) continue
			if (seen.has(id)) throw new Error(`Duplicate tldraw ${kind} registration: ${id}`)
			seen.add(id)
		}
		return [...constructors]
	}
}
