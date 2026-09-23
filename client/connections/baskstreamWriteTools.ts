import type { JsonValue } from 'tldraw'
import type { AgentConnectionTool } from './ConnectionRuntime'
import type { AgentConnectionToolRisk } from '../../shared/connections'
import { validateBaskstreamInput, resultHasFailure, baskstreamWriteOperations, type BaskstreamToolOperation } from '../../shared/baskstreamProtocol.ts'

type Request = (op: string, fields: Record<string, unknown>) => Promise<Record<string, unknown>>
const descriptions: Record<BaskstreamToolOperation, [string, Record<string, string>]> = {
 describe_write: ['Inspect writable point actions, value types, fallback and priorities.', { points: 'Array of 1–100 exact slot:/ point references.' }],
 read_tags: ['Read direct/implied tags and relations on existing components.', { ords: 'Array of 1–100 exact slot:/ component references.', includeRelations: 'Optional boolean, defaults true.', dictionary: 'Optional dictionary namespace.' }],
 read_alarms: ['Read current alarms to obtain exact UUIDs before acknowledgement or explicit force-clear.', { scope: 'open, ack_pending or all.', limit: '1–100.' }],
 write: ['Change one writable point. Set changes fallback; override uses priority 8; emergency_override uses priority 1. Auto releases the corresponding priority. Requires confirmation.', { point: 'Exact slot:/ point reference.', action: 'set, override, auto, emergency_override or emergency_auto.', value: 'Boolean, finite number or string required for set/override, omitted for auto.', durationSec: 'Optional positive integer seconds for override only.' }],
 write_tags: ['Set/remove direct tags on existing components. Does not create components or hierarchy definitions. Requires confirmation.', { targets: 'Array of 1–100 {ord, set?: [{id: "dictionary:name", value?: boolean|number|string|null, valueType?: marker|string|boolean|double|long}], remove?: ["dictionary:name"]}. Up to 100 edits per target.' }],
 write_relations: ['Add/remove direct relations between existing components. Does not create components or hierarchy definitions. Requires confirmation.', { targets: 'Array of 1–100 {ord, add?: [{id, endpoint, inbound?: boolean}], remove?: [{id, endpoint?: string, direction?: in|out}]}. IDs are dictionary:name; ord and endpoint are slot:/. Omitted removal endpoint removes all direct relations with that ID. Up to 100 edits per target.' }],
 ack_alarm: ['Acknowledge an existing alarm using its UUID. Requires confirmation.', { uuid: 'Alarm UUID from read_alarms.', source: 'Optional expected source slot:/ ORD.' }],
 ack_alarms: ['Acknowledge multiple existing alarms. Requires confirmation.', { uuids: 'Array of 1–100 alarm UUIDs from read_alarms.', source: 'Optional expected source slot:/ ORD.' }],
 clear_alarm: ['Force-clear an existing alarm. Use only when the user explicitly asks to force-clear. An active source can alarm again. Requires confirmation.', { uuid: 'Alarm UUID.', source: 'Optional expected source slot:/ ORD.' }],
 clear_alarms: ['Force-clear multiple alarms on explicit user request. Active sources can alarm again. Requires confirmation.', { uuids: 'Array of 1–100 alarm UUIDs.', source: 'Optional expected source slot:/ ORD.' }],
}

const RESULT_NOTE = 'Inspect individual results and current state. A higher priority may keep a point output unchanged. Do not repeat mutations automatically.'

/** Force-clearing alarms and priority-1 emergency writes get the stronger approval warning. */
function riskFor(op: BaskstreamToolOperation, input: Record<string, JsonValue>): AgentConnectionToolRisk {
 if (op === 'clear_alarm' || op === 'clear_alarms') return 'high'
 if (op === 'write' && typeof input.action === 'string' && input.action.startsWith('emergency_')) return 'high'
 return 'normal'
}

export function createBaskstreamWriteTools(operations: readonly string[], request: Request): AgentConnectionTool[] {
 const available = new Set(operations)
 return (Object.keys(descriptions) as BaskstreamToolOperation[]).filter(op => available.has(op)
  && (op !== 'write' || available.has('describe_write'))
  && (!['write_tags', 'write_relations'].includes(op) || available.has('read_tags'))).map((op): AgentConnectionTool => {
  const base = { id: op, capability: op, description: descriptions[op][0], inputSchema: descriptions[op][1] }
  if (!baskstreamWriteOperations.has(op)) {
   return { ...base, effect: 'read', execute: async (input) => request(op, validateBaskstreamInput(op, input)) }
  }
  /** Read-only preflight. Returns current station state, or undefined when the operation has none to show. */
  const prepare = async (input: Record<string, JsonValue>) => {
   const args = validateBaskstreamInput(op, input)
   if (op === 'write' && 'point' in args) {
    const state = await request('describe_write', { points: [args.point] })
    const points = state.points as Array<Record<string, unknown>> | undefined
    const point = points?.find(p => p.point === args.point)
    if (!point?.writable || !Array.isArray(point.actions) || !point.actions.includes(args.action)) throw new Error('Station does not permit this action on the selected point.')
    if (args.durationSec !== undefined && !point.supportsDuration) throw new Error('This point does not support a timed override.')
    if (args.value !== undefined && ((point.valueKind === 'boolean' && typeof args.value !== 'boolean') || (point.valueKind === 'numeric' && typeof args.value !== 'number'))) throw new Error(`Point requires a ${point.valueKind} value.`)
    return state
   }
   if ('targets' in args) {
    const state = await request('read_tags', { ords: args.targets.map(t => t.ord), includeRelations: true })
    const targets = state.targets as Array<Record<string, unknown>> | undefined
    if (resultHasFailure(state) || args.targets.some(target => !targets?.some(item => item.ord === target.ord && item.ok === true))) throw new Error('Some targets could not be read. Resolve them before changing tags or relations.')
    return state
   }
   // Alarm operations have no preflight read; the card shows only the proposed request.
   return undefined
  }
  return { ...base, effect: 'write', ...(op === 'clear_alarm' || op === 'clear_alarms' ? { risk: 'high' as const } : {}),
   prepare,
   riskFor: (input) => riskFor(op, input),
   // The runtime consumes the approval token and re-checks access immediately before this runs.
   dispatch: async (input) => request(op, { ...validateBaskstreamInput(op, input), confirmedWrite: true }),
   verify: async (input, response) => {
    const args = validateBaskstreamInput(op, input)
    if ('point' in args) return request('read', { points: [args.point] })
    if ('targets' in args) return request('read_tags', { ords: args.targets.map(t => t.ord), includeRelations: true })
    return { returnedByStation: (response as Record<string, unknown> | undefined)?.alarms }
   },
   responseHasFailure: resultHasFailure,
   resultNote: RESULT_NOTE,
  }
 })
}
