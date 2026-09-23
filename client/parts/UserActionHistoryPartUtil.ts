import { squashRecordDiffs } from 'tldraw'
import {
	convertTldrawIdToSimpleId,
	convertTldrawShapeToFocusedShape,
	convertTldrawShapeToFocusedType,
} from '../../shared/format/convertTldrawShapeToFocusedShape'
import { FocusedShape } from '../../shared/format/FocusedShape'
import { getChangedFields } from '../../shared/format/jsonEqual'
import { UserActionHistoryPart } from '../../shared/schema/PromptPartDefinitions'
import { AgentRequest } from '../../shared/types/AgentRequest'
import { AgentHelpers } from '../AgentHelpers'
import { PromptPartUtil, registerPromptPartUtil } from './PromptPartUtil'

export const UserActionHistoryPartUtil = registerPromptPartUtil(
	class UserActionHistoryPartUtil extends PromptPartUtil<UserActionHistoryPart> {
		static override type = 'userActionHistory' as const

		override getPart(_request: AgentRequest, helpers: AgentHelpers): UserActionHistoryPart {
			const { editor, agent } = helpers

			// Get the action history and clear it so that we can start tracking changes for the next request
			const diffs = agent.userAction.getHistory()
			agent.userAction.clearHistory()

			const part: UserActionHistoryPart = {
				type: 'userActionHistory',
				added: [],
				removed: [],
				updated: [],
			}

			const squashedDiff = squashRecordDiffs(diffs)
			const { added, updated, removed } = squashedDiff

			// Collect user-added shapes
			for (const shape of Object.values(added)) {
				if (shape.typeName !== 'shape') continue
				part.added.push({
					shapeId: convertTldrawIdToSimpleId(shape.id),
					type: convertTldrawShapeToFocusedType(shape),
				})
			}

			// Collect user-removed shapes
			for (const shape of Object.values(removed)) {
				if (shape.typeName !== 'shape') continue
				const focusedShape = convertTldrawShapeToFocusedShape(editor, shape)
				part.removed.push({
					shapeId: focusedShape.shapeId,
					type: focusedShape._type,
				})
			}

			// Collect user-updated shapes
			for (const [from, to] of Object.values(updated)) {
				if (from.typeName !== 'shape' || to.typeName !== 'shape') continue
				const fromFocusedShape = convertTldrawShapeToFocusedShape(editor, from)
				const toFocusedShape = convertTldrawShapeToFocusedShape(editor, to)

				const changeFocusedShape = getFocusedShapeChange(fromFocusedShape, toFocusedShape)
				if (!changeFocusedShape) continue

				const before = helpers.applyOffsetToShapePartial(changeFocusedShape.from)
				const after = helpers.applyOffsetToShapePartial(changeFocusedShape.to)

				part.updated.push({
					shapeId: toFocusedShape.shapeId,
					type: toFocusedShape._type,
					before: helpers.roundShapePartial(before),
					after: helpers.roundShapePartial(after),
				})
			}

			return part
		}
	}
)

/**
 * Get any changed properties between two focused shapes.
 * Uses structural equality: conversions build fresh objects (e.g. unknown-shape props),
 * so reference equality would report every update as a props change.
 * @param from - The original shape.
 * @param to - The new shape.
 * @returns The changed properties, or null if nothing the model can see changed.
 */
function getFocusedShapeChange(from: FocusedShape, to: FocusedShape) {
	if (from._type !== to._type) {
		return null
	}
	const change = getChangedFields(
		from as unknown as Record<string, unknown>,
		to as unknown as Record<string, unknown>
	)
	if (!change) return null
	return change as { from: Partial<FocusedShape>; to: Partial<FocusedShape> }
}
