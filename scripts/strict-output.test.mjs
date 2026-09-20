import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toStrictOutputSchema, fromStrictOutput } from '../shared/schema/strictOutput.ts'

const schema = {
	type: 'object', additionalProperties: false, required: ['actions'],
	properties: { actions: { type: 'array', items: { anyOf: [
		{ $ref: '#/$defs/connection' },
		{ type: 'object', additionalProperties: false, properties: { _type: { const: 'knowledge', type: 'string' }, id: { type: 'string' }, offset: { type: 'number' } }, required: ['_type'] },
	] } } },
	$defs: { connection: { type: 'object', additionalProperties: false, properties: {
		_type: { const: 'connectionTool', type: 'string' }, arguments: { type: 'object', additionalProperties: {} },
	}, required: ['_type'] } },
}

test('strict conversion includes every key, nullable optionals, and JSON encoded maps', () => {
	const strict = toStrictOutputSchema(schema)
	assert.deepEqual(strict.$defs.connection.required, ['_type', 'arguments'])
	assert.equal(strict.$defs.connection.properties.arguments.anyOf[0].type, 'string')
	assert.equal(strict.$defs.connection.properties.arguments.anyOf[1].type, 'null')
	assert.equal(strict.$defs.connection.additionalProperties, false)
	assert.deepEqual(schema.$defs.connection.required, ['_type'], 'Original schemas stay unchanged')
})

test('decoding restores maps and strips only absent optional fields through refs and unions', () => {
	assert.deepEqual(fromStrictOutput({ actions: [
		{ _type: 'knowledge', id: 'notes', offset: null },
		{ _type: 'connectionTool', arguments: '{"query":"AHU","values":[null,true,42]}' },
	] }, schema), { actions: [
		{ _type: 'knowledge', id: 'notes' },
		{ _type: 'connectionTool', arguments: { query: 'AHU', values: [null, true, 42] } },
	] })
})

test('partial JSON stays partial until complete validation, while required nulls survive', () => {
	assert.deepEqual(fromStrictOutput({ actions: [{ _type: 'connectionTool', arguments: '{"query":' }] }, schema), { actions: [{ _type: 'connectionTool', arguments: '{"query":' }] })
	const nullable = { type: 'object', properties: { value: { anyOf: [{ type: 'string' }, { type: 'null' }] } }, required: ['value'] }
	assert.deepEqual(fromStrictOutput({ value: null }, nullable), { value: null })
})
