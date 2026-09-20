import type { AccessPolicyPart } from '../../shared/schema/PromptPartDefinitions'
import type { AgentRequest } from '../../shared/types/AgentRequest'
import { PromptPartUtil, registerPromptPartUtil } from './PromptPartUtil'

export const AccessPolicyPartUtil = registerPromptPartUtil(
	class AccessPolicyPartUtil extends PromptPartUtil<AccessPolicyPart> {
		static override type = 'accessPolicy' as const
		override getPart(_request: AgentRequest): AccessPolicyPart {
			return { type: 'accessPolicy', policy: this.agent.getAccessPolicy() }
		}
	}
)
