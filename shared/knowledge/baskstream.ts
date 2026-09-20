import type { PluginKnowledgeBundle } from '../knowledge'

export const baskstreamKnowledge: PluginKnowledgeBundle = {
	pluginId: 'niagara-baskstream',
	version: '1.1.0',
	connectionTypes: ['baskstream'],
	entries: [
		{
			id: 'basdraw:baskstream-connection', kind: 'skill',
			title: 'Work with Niagara through baskStream',
			description: 'Use when discovering Niagara equipment or points, reading station values, or relating a control drawing to a baskStream station.',
			referenceIds: ['baskstream-api'],
			content: `Identify the connected adapter whose type is baskstream. Use its current tool descriptions as the authority for operations and arguments. Load reference baskstream-api before using unfamiliar operations.
Search project knowledge for equipment names, drawing references, station mappings and project constraints relevant to the request. Documents describe design intent; verify actual station structure and values using the connection.
Discover incrementally: shallow browse for structure, bounded search for known names, then batch read only the needed points. Preserve exact returned identifiers. If several points match, inspect their paths and equipment context before choosing. Report ambiguous matches instead of guessing.
Use the returned status and timestamp alongside values. A missing result is not zero or false. If the connection is unavailable, explain what could not be verified.
Before changing station data, check that an actual write tool is available and follow the runtime approval workflow. A skill cannot enable an operation. Never claim a write, subscription or discovery succeeded without its tool result.
For canvas work, use only currently exposed canvas actions. Do not invent custom shape or binding schemas from documentation. Identify the relevant objects and retain their existing content unless the user requested changes.
Stop after collecting sufficient evidence for the requested task; do not crawl or copy the entire station.`,
		},
		{
			id: 'baskstream-api', kind: 'reference',
			title: 'baskStream adapter reference',
			description: 'Arguments, returned identifiers and limitations of the basdraw baskStream adapter.',
			content: `The basdraw adapter currently implements these read tools. Only call tools present in the current connection description.
browse: { base?: string }. Browse one level, default slot:/. Expand returned container paths as needed.
search: { query: string, base?: string, limit?: number }. Search point names below a base. Limit is 1–100. Narrow the base or query when results are truncated.
read: { points: string[] }. Read 1–100 exact point references returned by discovery. Results may include value, display, status, timestamps and type.
The connection ID selects the adapter instance; an ORD selects a Niagara component. They are not interchangeable. Never apply these conventions to a different connection type.
Live updates, histories and other features present elsewhere in the application are not automatically agent tools. The adapter tool list is authoritative. Station permissions still apply. Authentication belongs to the connection layer, never project notes or model arguments.`,
		},
	],
}
