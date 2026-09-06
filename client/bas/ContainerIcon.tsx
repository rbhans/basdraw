import { containerKind } from './containerKind'
import type { StationNode } from './types'

const descriptions = {
	equipment: 'Equipment · identified by an equipment tag',
	device: 'Device / controller · identified by the driver, not necessarily one piece of equipment',
	folder: 'Container · equipment identity not confirmed',
}
export function ContainerIcon({ node }: { node: StationNode }) {
	const kind = containerKind(node)
	return <span className="tree-container-icon" data-container-kind={kind} title={descriptions[kind]}>
		<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={descriptions[kind]}>
			{kind === 'equipment' ? <><rect x="3" y="3" width="14" height="14" rx="2" /><circle cx="8" cy="9" r="2.5" /><path d="M13 6h1M13 9h1M6 14h8" /></> : kind === 'device' ? <><rect x="5" y="5" width="10" height="10" rx="1.5" /><path d="M8 2v3m4-3v3M8 15v3m4-3v3M2 8h3m-3 4h3m10-4h3m-3 4h3M8 8h4v4H8z" /></> : <path d="M2 6V4.5A1.5 1.5 0 0 1 3.5 3H8l2 3h6.5A1.5 1.5 0 0 1 18 7.5v7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 2 14.5Z" />}
		</svg>
	</span>
}
