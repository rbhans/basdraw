import { FocusedShape } from './FocusedShape'

export interface BlurryShape {
	shapeId: string
	text?: string
	type: FocusedShape['_type']
	subType?: string
	x: number
	y: number
	w: number
	h: number
}
