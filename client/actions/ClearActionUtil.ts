import { ClearAction } from '../../shared/schema/AgentActionSchemas'
import { Streaming } from '../../shared/types/Streaming'
import { convertTldrawIdToSimpleId } from '../../shared/format/convertTldrawShapeToFocusedShape'
import { AgentHelpers } from '../AgentHelpers'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'

export const ClearActionUtil = registerActionUtil(
	class ClearActionUtil extends AgentActionUtil<ClearAction> {
		static override type = 'clear' as const

		/**
		 * Tell the model what the action's schema is
		 */

		/**
		 * Tell the model how to display this action in the chat history UI
		 */
		override getInfo() {
			return {
				icon: 'trash' as const,
				description: 'Cleared the canvas',
			}
		}

		/**
		 * Tell the model how to apply the action
		 */
		override applyAction(action: Streaming<ClearAction>, helpers: AgentHelpers) {
			// Don't do anything if the action hasn't finished streaming
			if (!action.complete) return

			// Delete all shapes on the page, except shapes the user locked (and anything that
			// contains or sits inside a locked shape, since deleting it would remove the lock too)
			const { editor } = this

			const deletable = []
			let skipped = 0
			for (const shape of editor.getCurrentPageShapes()) {
				if (helpers.isShapeProtected(convertTldrawIdToSimpleId(shape.id), { includeDescendants: true })) {
					skipped++
					continue
				}
				deletable.push(shape.id)
			}
			editor.deleteShapes(deletable)
			if (skipped > 0) {
				helpers.reportActionNote(
					'clear:locked',
					`Clear kept ${skipped} shape(s) because they are locked by the user or contain/sit inside locked shapes.`
				)
			}
		}
	}
)
