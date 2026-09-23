import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { BasdrawPluginRegistry, HOST_CONTEXTS } from '../client/plugins/registry.ts'
import { builtinPluginManifest, PLUGIN_CONTEXTS } from '../client/plugins/pluginManifest.ts'

const manifest = Object.values(builtinPluginManifest)
const registry = new BasdrawPluginRegistry(manifest)
const optional = manifest.filter((plugin) => !plugin.alwaysEnabled).map((plugin) => plugin.id)
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

function assertConsistent(enabled, label) {
	const ids = new Set(enabled.map((plugin) => plugin.id))
	for (const plugin of enabled) {
		for (const dependency of plugin.dependencies ?? []) assert.ok(ids.has(dependency), `${label}: ${plugin.id} enabled without ${dependency}`)
	}
	assert.deepEqual(registry.missingContexts(enabled), [], `${label}: required context missing`)
	for (const plugin of manifest.filter((candidate) => candidate.alwaysEnabled)) assert.ok(ids.has(plugin.id), `${label}: core ${plugin.id} disabled`)
}

test('every combination of disabled optional plugins resolves to a consistent set', () => {
	assert.ok(optional.length >= 8 && optional.length <= 16, 'matrix stays exhaustive but bounded')
	for (let mask = 0; mask < 2 ** optional.length; mask++) {
		const disabled = optional.filter((_, index) => mask & (1 << index))
		assertConsistent(registry.resolveEnabled({ disabled, enabled: [] }), `disabled [${disabled.join(', ')}]`)
	}
})

test('disabling one plugin removes exactly its dependents and nothing else', () => {
	for (const id of optional) {
		const enabled = new Set(registry.resolveEnabled({ disabled: [id], enabled: [] }).map((plugin) => plugin.id))
		for (const plugin of manifest) {
			const dependsOnDisabled = plugin.id === id || registry.dependencyClosure(plugin.id).has(id)
			assert.equal(enabled.has(plugin.id), !dependsOnDisabled || Boolean(plugin.alwaysEnabled), `disable ${id} → ${plugin.id}`)
		}
	}
})

test('plugin-provided contexts are consumed only by providers, required dependents or optional consumers', () => {
	const providers = new Map(manifest.flatMap((plugin) => (plugin.contexts?.provides ?? []).map((context) => [context, plugin.id])))
	for (const plugin of manifest) {
		for (const context of plugin.contexts?.requires ?? []) {
			if (HOST_CONTEXTS.includes(context)) continue
			const provider = providers.get(context)
			assert.ok(provider === plugin.id || registry.dependencyClosure(plugin.id).has(provider), `${plugin.id} requires ${context} without depending on ${provider}`)
		}
		for (const dependency of plugin.optionalDependencies ?? []) assert.ok(!(plugin.dependencies ?? []).includes(dependency))
	}
	// Live behaviors must work without the baskStream connection (the reported crash).
	const behaviors = builtinPluginManifest.behaviors
	assert.ok(!(behaviors.dependencies ?? []).includes('niagara-baskstream'))
	assert.ok(behaviors.contexts.optional.includes(PLUGIN_CONTEXTS.pointDrag))
	assert.ok(!behaviors.contexts.requires.includes(PLUGIN_CONTEXTS.pointDrag))
})

test('optional context hooks degrade instead of throwing when their provider is not mounted', () => {
	const source = read('client/bas/PointDrag.tsx')
	const hook = source.slice(source.indexOf('export function usePointDrag'), source.indexOf('\n}\n', source.indexOf('export function usePointDrag')))
	assert.ok(hook.length > 0, 'usePointDrag exists')
	assert.doesNotMatch(hook, /throw/, 'usePointDrag must return an inert fallback')
	assert.match(hook, /\?\? INERT_DRAG/)
	const runtime = read('client/bas/BasRuntimeContext.tsx')
	const useRuntime = runtime.slice(runtime.indexOf('export function useBasRuntime'), runtime.indexOf('\n}\n', runtime.indexOf('export function useBasRuntime')))
	assert.doesNotMatch(useRuntime, /throw/, 'shapes render offline outside the runtime provider')
})

test('builtin descriptors take their dependency metadata from the manifest', () => {
	const source = read('client/plugins/builtinPlugins.tsx')
	for (const key of Object.keys(builtinPluginManifest)) assert.match(source, new RegExp(`\\.\\.\\.manifest\\.${key},`), `${key} spreads its manifest entry`)
	assert.doesNotMatch(source, /\n\s+dependencies:/, 'dependencies are declared only in the manifest')
	assert.doesNotMatch(source, /import \{[^}]*\} from '\.\.\/bas\/VectorPdfDialog'/, 'the PDF dialog is split into its own chunk')
})

test('plugin contributions render inside error boundaries', () => {
	const components = read('client/plugins/PluginComponents.tsx')
	for (const name of ['PluginCanvasOverlays', 'PluginShapeWrapper', 'PluginAppPanels']) {
		const start = components.search(new RegExp(`(function|const) ${name}\\b`))
		assert.ok(start >= 0)
		const end = components.indexOf('\nexport ', start)
		assert.match(components.slice(start, end < 0 ? undefined : end), /<PluginBoundary/, `${name} isolates contributions`)
	}
	assert.match(read('client/bas/DataShapeStylePanel.tsx'), /<PluginBoundary[^>]*fallback="inline"/)
})

test('registry rejects undeclared cross-plugin context use', () => {
	const category = { id: 'core', label: 'Core', order: 0 }
	const plugin = (id, extra = {}) => ({ id, category, label: id, description: '', version: '1.0.0', ...extra })
	const provider = plugin('connection', { contexts: { provides: ['point-drag'] } })
	assert.throws(() => new BasdrawPluginRegistry([provider, plugin('behaviors', { contexts: { requires: ['point-drag'] } })]), /requires context point-drag/)
	assert.doesNotThrow(() => new BasdrawPluginRegistry([provider, plugin('behaviors', { dependencies: ['connection'], contexts: { requires: ['point-drag'] } })]))
	assert.doesNotThrow(() => new BasdrawPluginRegistry([provider, plugin('behaviors', { optionalDependencies: ['connection'], contexts: { optional: ['point-drag'] } })]))
	assert.throws(() => new BasdrawPluginRegistry([plugin('behaviors', { contexts: { optional: ['typo-context'] } })]), /unknown optional context/)
	assert.throws(() => new BasdrawPluginRegistry([plugin('behaviors', { optionalDependencies: ['absent'] })]), /missing plugin absent/)
})
