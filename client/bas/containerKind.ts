import { isPointNode, type StationNode } from './types'

// Use direct metadata only: names, child points and inherited equipment references
// are not proof that the current node represents equipment.
export function containerKind(node: StationNode): 'equipment' | 'device' | 'folder' {
	if (isPointNode(node)) return 'folder'
	const tags = Array.isArray(node.metadata?.tags) ? node.metadata.tags : []
	const equipment = tags.some((tag) => {
		const name = (tag.name || tag.id?.split(':').at(-1) || '').toLowerCase()
		return (name === 'equip' || name === 'equipment') && !/^(false|0)$/i.test(String(tag.value).trim())
	})
	if (equipment) return 'equipment'
	const classification = node.metadata?.classification
	if (classification?.isDriverDevice === true || classification?.equipmentCertainty === 'device') return 'device'
	return 'folder'
}
