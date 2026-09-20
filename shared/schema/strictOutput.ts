type Schema = Record<string, any>

/** Adapt the SDK's optional fields and open argument maps to strict output. */
export function toStrictOutputSchema(schema: Schema): Schema {
	if (schema.type === 'object' && !schema.properties && schema.additionalProperties !== false) {
		return { type: 'string', description: 'A JSON-encoded object. Encode the named tool arguments as valid JSON, for example {"query":"temperature"}.' }
	}
	const result: Schema = { ...schema }
	for (const key of ['$defs', 'definitions', 'properties']) {
		if (schema[key]) result[key] = Object.fromEntries(Object.entries(schema[key]).map(([name, value]) => [name, toStrictOutputSchema(value as Schema)]))
	}
	for (const key of ['anyOf', 'oneOf']) if (schema[key]) result[key] = schema[key].map(toStrictOutputSchema)
	if (schema.items) result.items = toStrictOutputSchema(schema.items)
	if (schema.type === 'object') {
		const required = new Set(schema.required ?? [])
		result.properties ??= {}
		for (const [name, value] of Object.entries(result.properties)) {
			if (!required.has(name)) result.properties[name] = { anyOf: [value, { type: 'null' }] }
		}
		result.required = Object.keys(result.properties)
		result.additionalProperties = false
	}
	return result
}

/** Restore the original SDK action representation before applying any actions. */
export function fromStrictOutput(value: any, schema: Schema, root = schema): any {
	if (schema.$ref) {
		const target = schema.$ref.slice(2).split('/').reduce((part: any, key: string) => part?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], root)
		return target ? fromStrictOutput(value, target, root) : value
	}
	const variants = schema.anyOf ?? schema.oneOf
	if (variants) {
		const variant = variants.find((candidate: Schema) => matches(value, candidate, root))
		return variant ? fromStrictOutput(value, variant, root) : value
	}
	if (schema.type === 'object' && !schema.properties && schema.additionalProperties !== false && typeof value === 'string') {
		try { return JSON.parse(value) } catch { return value } // Partial streamed JSON is not executable yet.
	}
	if (Array.isArray(value) && schema.items) return value.map((item) => fromStrictOutput(item, schema.items, root))
	if (value && typeof value === 'object' && !Array.isArray(value) && schema.properties) {
		return Object.fromEntries(Object.entries(value)
			.filter(([key, item]) => item !== null || (schema.required ?? []).includes(key))
			.map(([key, item]) => [key, schema.properties[key] ? fromStrictOutput(item, schema.properties[key], root) : item]))
	}
	return value
}

function matches(value: any, schema: Schema, root: Schema): boolean {
	if (schema.$ref) return matches(value, schema.$ref.slice(2).split('/').reduce((part: any, key: string) => part?.[key], root) ?? {}, root)
	if (schema.anyOf) return schema.anyOf.some((candidate: Schema) => matches(value, candidate, root))
	if (schema.const !== undefined) return value === schema.const
	if (schema.type === 'null') return value === null
	if (schema.type === 'array') return Array.isArray(value)
	if (schema.type === 'object') {
		if (typeof value === 'string' && !schema.properties && schema.additionalProperties !== false) return true
		if (!value || typeof value !== 'object' || Array.isArray(value)) return false
		return Object.entries(schema.properties ?? {}).every(([key, child]) => (child as Schema).const === undefined || value[key] === (child as Schema).const)
	}
	return !schema.type || typeof value === schema.type || (schema.type === 'integer' && typeof value === 'number')
}
