import type { ConnectionsPart } from '../../shared/schema/PromptPartDefinitions'
import type { AgentRequest } from '../../shared/types/AgentRequest'
import { connectionRuntime } from '../connections/ConnectionRuntime'
import { PromptPartUtil, registerPromptPartUtil } from './PromptPartUtil'

export const ConnectionsPartUtil = registerPromptPartUtil(
	class ConnectionsPartUtil extends PromptPartUtil<ConnectionsPart> {
		static override type = 'connections' as const

		override getPart(_request: AgentRequest): ConnectionsPart {
			return { type: 'connections', connections: connectionRuntime.describe(this.agent.getAccessPolicy().connections) }
		}
	}
)
