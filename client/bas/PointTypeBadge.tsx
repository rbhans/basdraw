import { pointType } from './pointType'
import type { StationNode } from './types'

const badges = {
	boolean: { letter: 'B', label: 'Boolean point' },
	numeric: { letter: 'N', label: 'Numeric point' },
	enum: { letter: 'E', label: 'Enumerated point' },
	unknown: { letter: '•', label: 'Point type unavailable' },
}
export function PointTypeBadge({ node }: { node: StationNode }) {
	const type = pointType(node), badge = badges[type]
	return <span className="point-type-badge" data-point-type={type} role="img" aria-label={badge.label} title={badge.label}>{badge.letter}</span>
}
