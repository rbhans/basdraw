export type TlsMode = 'strict' | 'insecure'

export type ConnectionProfile = {
	alias: string
	name: string
	stationUrl: string
	username: string
	tlsMode: TlsMode
}

export type ConnectionInput = ConnectionProfile & {
	password: string
	remember: boolean
}

export type RuntimeProperty = 'fill' | 'levelFill' | 'label' | 'visibility' | 'opacity' | 'rotation' | 'scale' | 'movement'

export type LabelPlacement = 'center' | 'top' | 'right' | 'bottom' | 'left'

export type BindingOptions =
	| {
		kind: 'label'
		placement: LabelPlacement
		gap: number
		colorMode?: 'status' | 'custom'
		color?: string
		background?: 'solid' | 'none'
		cornerRadius?: number
		fontSize?: number
		caption?: string
		stackGap?: number
	}
	| {
		kind: 'rotation'
		mode: 'position' | 'spin'
		secondsPerTurn: number
		direction: 'clockwise' | 'counterclockwise'
		restAngle: number
		/** Normalized local bounds: 0 = left/top, 1 = right/bottom. Omitted = center. */
		pivot?: { x: number; y: number }
	}
	| {
		kind: 'movement'
		mode: 'position' | 'travel'
		axis: 'x' | 'y'
		direction: 'positive' | 'negative'
		distance: number
		secondsPerCycle: number
	}
	| { kind: 'levelFill'; color: string; direction: 'up' | 'down' | 'left' | 'right' }

export type BindingValueMapping =
	| { kind: 'auto' }
	| { kind: 'boolean'; falseValue: number; trueValue: number }
	| {
		kind: 'number'
		inputMin: number
		inputMax: number
		outputMin: number
		outputMax: number
		clamp: boolean
	}
	| { kind: 'enum'; entries: Array<{ match: string; output: number }>; fallback: number }

export type ShapeBinding = {
	name?: string
	enabled?: boolean
	id: string
	shapeId: string
	stationAlias: string
	pointReference: string
	pointLabel: string
	runtimeProperty: RuntimeProperty
	mapping: BindingValueMapping
	options?: BindingOptions
}

export type CanvasDocument = {
	version: 2
	stationAlias: string | null
	bindings: ShapeBinding[]
}

export type PointSnapshot = {
	point: string
	ok?: boolean
	value?: unknown
	displayValue?: string
	display?: string
	status?: string
	timestamp?: number
	valueType?: string
}

export type HistoryRecord = {
	timestamp: number
	value: unknown
	valueType?: string
	status?: string
	recordType?: string
}

export type HistorySeriesState = {
	loading: boolean
	error?: string
	records: HistoryRecord[]
	display?: string
	historyOrd?: string
	start?: number
	end?: number
}

export type DataWidgetPoint = {
	pointReference: string
	pointLabel: string
	equipmentReference: string
	equipmentLabel: string
	fieldKey: string
	fieldLabel: string
}

export type TrendWidgetSeries = {
	pointReference: string
	pointLabel: string
	color: string
}

export type StationNode = {
	ord: string
	slotPath?: string | null
	name?: string
	display?: string
	description?: string
	typeSpec?: string
	kind?: string
	hasChildren?: boolean
	ok?: boolean
	writable?: boolean
	features?: string[]
	operations?: string[]
	children?: StationNode[]
	metadata?: {
		classification?: { isControlPoint?: boolean; isDriverDevice?: boolean; equipmentCertainty?: string }
		tags?: Array<{ id?: string; dictionary?: string | null; name?: string; value?: string | boolean | number | null }>
	}
}

export type Capabilities = {
	apiVersion?: string
	operations?: string[]
	limits?: {
		subscriptionLeaseSec?: number
		maxLivePointsPerStream?: number
	}
	subscriptions?: {
		viewGroups?: boolean
		leasedGroups?: boolean
	}
	policy?: {
		hierarchyBrowse?: boolean
	}
}

export type BasDocumentAction =
	| { type: 'create_binding'; binding: ShapeBinding }
	| { type: 'update_binding'; bindingId: string; patch: Partial<Omit<ShapeBinding, 'id'>> }
	| { type: 'remove_binding'; bindingId: string }
	| { type: 'set_station_alias'; stationAlias: string | null }

export const AI_READY_ACTIONS = [
	'inspect_canvas',
	'list_bindings',
	'create_binding',
	'update_binding',
	'remove_binding',
	'search_niagara',
	'read_point_values',
	'arrange_shapes',
] as const

export function applyDocumentAction(document: CanvasDocument, action: BasDocumentAction): CanvasDocument {
	switch (action.type) {
		case 'create_binding':
			return {
				...document,
				stationAlias: action.binding.stationAlias,
				bindings: [...document.bindings, action.binding],
			}
		case 'update_binding':
			const currentBinding = document.bindings.find((binding) => binding.id === action.bindingId)
			if (!currentBinding) return document
			const updatedBinding = { ...currentBinding, ...action.patch, id: currentBinding.id }
			return {
				...document,
				stationAlias: updatedBinding.stationAlias,
				bindings: document.bindings.map((binding) => binding.id === action.bindingId ? updatedBinding : binding),
			}
		case 'remove_binding':
			return { ...document, bindings: document.bindings.filter((binding) => binding.id !== action.bindingId) }
		case 'set_station_alias':
			return { ...document, stationAlias: action.stationAlias }
	}
}

export function isPointNode(node: StationNode) {
	return node.features?.includes('point') === true ||
		node.metadata?.classification?.isControlPoint === true ||
		/ControlPoint|NumericPoint|BooleanPoint|EnumPoint/i.test(node.typeSpec || '')
}

export function nodeLabel(node: StationNode) {
	return node.display || node.name || node.ord.split('/').at(-1) || node.ord
}
