import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AgentPluginRuntime } from '../client/plugins/AgentPluginRuntime.ts'

const category = { id: 'future', label: 'Future', order: 100 }

test('enabled plugins describe, inspect and execute namespaced canvas capabilities', () => {
	const runtime = new AgentPluginRuntime()
	let executed = null
	runtime.setPlugins([{
		id: 'example-plugin', category, version: '1.0.0', label: 'Example', description: '',
		agent: { canvasCapabilities: [{
			id: 'widget', title: 'Widget', description: 'Create a future widget.', operations: ['create'], inputSchema: { label: 'string' },
			inspect: (_editor, shape) => shape.type === 'future-widget' ? { label: shape.props.label } : null,
			execute: (input) => { executed = input; return { ok: true } },
		}] },
	}])
	assert.deepEqual(runtime.describe().map(({ pluginId, capabilityId }) => [pluginId, capabilityId]), [['example-plugin', 'widget']])
	const editor = { getIsReadonly: () => false }
	assert.deepEqual(runtime.inspect(editor, [{ id: 'shape:one', type: 'future-widget', props: { label: 'One' } }]), [{
		shapeId: 'one', shapeType: 'future-widget', contributions: { 'example-plugin:widget': { label: 'One' } },
	}])
	runtime.execute({ pluginId: 'example-plugin', capabilityId: 'widget', editor, operation: 'create', shapeId: null, position: null, arguments: { label: 'Two' } })
	assert.equal(executed.arguments.label, 'Two')
})

test('plugin canvas runtime rejects disabled, undeclared, unsupported and read-only operations', () => {
	const runtime = new AgentPluginRuntime()
	runtime.setPlugins([{ id: 'p', category, version: '1.0.0', label: 'P', description: '', agent: { canvasCapabilities: [{ id: 'c', title: 'C', description: 'C', operations: ['create'], inputSchema: {}, execute: () => undefined }] } }])
	const input = { pluginId: 'p', capabilityId: 'c', editor: { getIsReadonly: () => false }, operation: 'update', shapeId: null, position: null, arguments: {} }
	assert.throws(() => runtime.execute(input), /does not support/)
	assert.throws(() => runtime.execute({ ...input, operation: 'create', capabilityId: 'missing' }), /not enabled/)
	assert.throws(() => runtime.execute({ ...input, operation: 'create', editor: { getIsReadonly: () => true } }), /read-only/)
})
