import { nodeLabel, type DataWidgetPoint, type StationNode } from './types'

export const trendColors = ['#4263eb', '#f76707', '#0ca678', '#ae3ec9', '#e03131', '#1098ad', '#f59f00', '#7048e8']
export const pointReference = (node: StationNode) => node.slotPath || node.ord

export function toDataWidgetPoint(node: StationNode): DataWidgetPoint {
	const reference = pointReference(node)
	const marker = '/points/'
	const markerIndex = reference.lastIndexOf(marker)
	const equipmentReference = markerIndex >= 0 ? reference.slice(0, markerIndex) : reference.slice(0, reference.lastIndexOf('/'))
	const fieldKey = markerIndex >= 0 ? reference.slice(markerIndex + marker.length) : reference.split('/').at(-1) || reference
	return { pointReference: reference, pointLabel: nodeLabel(node), equipmentReference, equipmentLabel: equipmentReference.split('/').at(-1) || 'Equipment', fieldKey, fieldLabel: nodeLabel(node) }
}

export function tableLayout(points: DataWidgetPoint[]) {
	const rows = [...new Map(points.map((point) => [point.equipmentReference, point.equipmentLabel])).entries()]
	const columns = [...new Map(points.map((point) => [point.fieldKey, point.fieldLabel])).entries()]
	const cells = new Map<string, DataWidgetPoint[]>()
	for (const point of points) {
		const key = JSON.stringify([point.equipmentReference, point.fieldKey])
		cells.set(key, [...cells.get(key) || [], point])
	}
	return { rows, columns, cells, duplicates: [...cells.values()].filter((cell) => cell.length > 1).length, missing: rows.length * columns.length - cells.size }
}
