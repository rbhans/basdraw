import type { StationNode } from './types'

export function pointType(node: Pick<StationNode, 'typeSpec'>): 'boolean' | 'numeric' | 'enum' | 'unknown' {
	const type = node.typeSpec?.split(':').at(-1) || ''
	if (/boolean|bool/i.test(type)) return 'boolean'
	if (/numeric/i.test(type)) return 'numeric'
	if (/enum/i.test(type)) return 'enum'
	return 'unknown'
}
