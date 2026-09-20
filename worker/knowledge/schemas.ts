import { z } from 'zod'

const scopeFields = {
	scopeType: z.enum(['global', 'project', 'connection']),
	scopeId: z.string().trim().min(1).max(200).nullable().optional(),
}

export const createKnowledgeEntrySchema = z.object({
	id: z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/).optional(),
	kind: z.enum(['skill', 'reference']),
	title: z.string().trim().min(1).max(160),
	description: z.string().trim().max(600).default(''),
	content: z.string().trim().min(1).max(100_000),
	...scopeFields,
	enabled: z.boolean().default(true),
	priority: z.number().int().min(-1000).max(1000).default(0),
	source: z.string().trim().min(1).max(80).default('user'),
	pluginId: z.string().trim().min(1).max(120).nullable().optional(),
	tags: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
}).superRefine((value, context) => {
	if (value.kind === 'skill' && value.content.length > 12_000) {
		context.addIssue({ code: 'custom', path: ['content'], message: 'Keep skills under 12,000 characters. Store longer supporting material as references.' })
	}
	if (value.scopeType === 'global' && value.scopeId) {
		context.addIssue({ code: 'custom', path: ['scopeId'], message: 'Global entries cannot have a scope id.' })
	}
	if (value.scopeType !== 'global' && !value.scopeId) {
		context.addIssue({ code: 'custom', path: ['scopeId'], message: `${value.scopeType} entries require a scope id.` })
	}
})

export const updateKnowledgeEntrySchema = z.object({
	kind: z.enum(['skill', 'reference']).optional(),
	title: z.string().trim().min(1).max(160).optional(),
	description: z.string().trim().max(600).optional(),
	content: z.string().trim().min(1).max(100_000).optional(),
	scopeType: z.enum(['global', 'project', 'connection']).optional(),
	scopeId: z.string().trim().min(1).max(200).nullable().optional(),
	enabled: z.boolean().optional(),
	priority: z.number().int().min(-1000).max(1000).optional(),
	source: z.string().trim().min(1).max(80).optional(),
	pluginId: z.string().trim().min(1).max(120).nullable().optional(),
	tags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
}).strict()

export type CreateKnowledgeEntryInput = z.infer<typeof createKnowledgeEntrySchema>
export type UpdateKnowledgeEntryInput = z.infer<typeof updateKnowledgeEntrySchema>
