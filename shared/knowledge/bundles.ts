import type { PluginKnowledgeBundle } from '../knowledge'
import { baskstreamKnowledge } from './baskstream'
import {
	behaviorKnowledge,
	canvasAgentKnowledge,
	dataWidgetKnowledge,
	vectorPdfKnowledge,
	webViewKnowledge,
} from './canvasAgent'
import { relationshipKnowledge } from './relationships'
import { documentKnowledge } from './documents'

/** Shared installation catalog, imported by both plugin registration and Worker. */
export const knowledgeBundles: readonly PluginKnowledgeBundle[] = [
	baskstreamKnowledge,
	canvasAgentKnowledge,
	behaviorKnowledge,
	dataWidgetKnowledge,
	vectorPdfKnowledge,
	webViewKnowledge,
	relationshipKnowledge,
	documentKnowledge,
]

const ids = new Set<string>()
for (const bundle of knowledgeBundles) {
	for (const entry of bundle.entries) {
		if (entry.kind === 'skill' && entry.content.length > 12_000) throw new Error(`Skill ${entry.id} must move long supporting material into references.`)
		if (ids.has(entry.id)) throw new Error(`Duplicate bundled knowledge id: ${entry.id}`)
		ids.add(entry.id)
	}
	for (const entry of bundle.entries) {
		for (const id of entry.referenceIds ?? []) {
			if (!bundle.entries.some((reference) => reference.id === id && reference.kind === 'reference')) {
				throw new Error(`Missing reference ${id} in ${bundle.pluginId}`)
			}
		}
	}
}
