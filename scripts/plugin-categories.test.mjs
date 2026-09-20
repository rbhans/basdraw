import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BasdrawPluginRegistry } from '../client/plugins/registry.ts'

const core = { id: 'core', label: 'Core', order: 0 }
const imports = { id: 'imports', label: 'Import & embed', order: 200 }
const data = { id: 'data', label: 'Data & charts', order: 100 }
const plugin = (id, category, extra = {}) => ({ id, category, label: id, description: '', version: '1.0.0', ...extra })

test('categories group new plugins, sort independently of registration, and omit mandatory core', () => {
	const registry = new BasdrawPluginRegistry([
		plugin('identity', core, { alwaysEnabled: true }), plugin('pdf', imports),
		plugin('table', data), plugin('web', imports), plugin('future-library', imports),
	])
	assert.deepEqual(registry.categories().map(({ category, plugins }) => [category.id, plugins.map(p => p.id)]), [
		['data', ['table']], ['imports', ['pdf', 'web', 'future-library']],
	])
	assert.deepEqual(registry.resolveEnabled({ disabled: ['pdf', 'identity'], enabled: [] }).map(p => p.id),
		['identity', 'table', 'web', 'future-library'])
	assert.equal(registry.categories()[1].plugins.length, 3, 'disabled tools remain discoverable in their category')
})

test('category metadata must be valid and consistent across plugins', () => {
	assert.throws(() => new BasdrawPluginRegistry([plugin('missing', undefined)]), /valid category/)
	assert.throws(() => new BasdrawPluginRegistry([
		plugin('pdf', imports), plugin('web', { ...imports, label: 'Other label' }),
	]), /Conflicting metadata/)
})
