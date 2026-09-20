import type { PluginKnowledgeBundle } from '../knowledge'

export const relationshipKnowledge: PluginKnowledgeBundle = {
	pluginId: 'relationship-map', version: '1.0.0',
	entries: [{
		id: 'basdraw:relationships', kind: 'skill', title: 'Express canvas relationships',
		description: 'Use when the user wants to connect existing documents, equipment, concepts or other canvas items.',
		content: `Relationships use native bound tldraw arrows with small basdraw metadata. Create them between two existing shapes only when the relationship helps communicate structure or the user asks for it. Use a concise type such as feeds, controls, documents, depends-on or related, and an optional visible label. Do not treat a canvas relationship as a Niagara wire, command or proof of live station connectivity. Preserve the connected shapes and use inspected relationship arrow IDs for updates or deletion.`,
	}],
}
