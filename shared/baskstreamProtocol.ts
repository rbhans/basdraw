import { z } from 'zod'

const ord = z.string().trim().startsWith('slot:/').max(2000)
const qualified = z.string().regex(/^[A-Za-z_][\w-]*:[A-Za-z_][\w-]*$/).max(200)
const scalar = z.union([z.string().max(4000), z.number().finite(), z.boolean(), z.null()])
const targets = <T extends z.ZodType>(item: T) => z.array(item).min(1).max(100)
const tag = z.object({ id: qualified, value: scalar.optional(), valueType: z.enum(['marker', 'string', 'boolean', 'double', 'long']).optional() }).strict()
const addRelation = z.object({ id: qualified, endpoint: ord, inbound: z.boolean().optional() }).strict()
const removeRelation = z.object({ id: qualified, endpoint: ord.optional(), direction: z.enum(['in', 'out']).optional() }).strict()
const tagTarget = z.object({ ord, set: targets(tag).optional(), remove: targets(qualified).optional() }).strict()
 .refine(v => (v.set?.length ?? 0) + (v.remove?.length ?? 0) > 0 && (v.set?.length ?? 0) + (v.remove?.length ?? 0) <= 100, 'Provide 1–100 tag edits per target.')
const relationTarget = z.object({ ord, add: targets(addRelation).optional(), remove: targets(removeRelation).optional() }).strict()
 .refine(v => (v.add?.length ?? 0) + (v.remove?.length ?? 0) > 0 && (v.add?.length ?? 0) + (v.remove?.length ?? 0) <= 100, 'Provide 1–100 relation edits per target.')
const alarm = z.object({ uuid: z.string().uuid(), source: ord.optional() }).strict()
const alarms = z.object({ uuids: targets(z.string().uuid()), source: ord.optional() }).strict()

/** Exact supported wire contracts from baskStream's THIRD_PARTY_API.md. */
export const baskstreamSchemas = {
 describe_write: z.object({ points: targets(ord) }).strict(),
 read_tags: z.object({ ords: targets(ord), dictionary: z.string().max(100).optional(), includeRelations: z.boolean().optional() }).strict(),
 read_alarms: z.object({ scope: z.enum(['open', 'ack_pending', 'all']).default('open'), limit: z.number().int().min(1).max(100).default(100) }).strict(),
 write: z.object({ point: ord, action: z.enum(['set', 'override', 'auto', 'emergency_override', 'emergency_auto']), value: scalar.optional(), durationSec: z.number().int().positive().max(31_536_000).optional() }).strict()
  .refine(v => ['auto', 'emergency_auto'].includes(v.action) ? v.value === undefined && v.durationSec === undefined : v.value !== undefined && v.value !== null, 'Set/override needs a non-null value. Auto actions take no value or duration.')
  .refine(v => v.durationSec === undefined || v.action === 'override', 'Duration is supported only for override.'),
 write_tags: z.object({ targets: targets(tagTarget) }).strict(),
 write_relations: z.object({ targets: targets(relationTarget) }).strict(),
 ack_alarm: alarm, clear_alarm: alarm, ack_alarms: alarms, clear_alarms: alarms,
}
export type BaskstreamToolOperation = keyof typeof baskstreamSchemas
export const baskstreamWriteOperations = new Set<string>(['write', 'write_tags', 'write_relations', 'ack_alarm', 'ack_alarms', 'clear_alarm', 'clear_alarms'])
export function validateBaskstreamInput(op: BaskstreamToolOperation, input: unknown) { return baskstreamSchemas[op].parse(input) }

export function resultHasFailure(value: unknown): boolean {
 if (!value || typeof value !== 'object') return false
 if (Array.isArray(value)) return value.some(resultHasFailure)
 const record = value as Record<string, unknown>
 return record.ok === false || record.op === 'error' || Object.values(record).some(resultHasFailure)
}
