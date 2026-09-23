import type { JsonValue } from 'tldraw'
import { useEffect, type ReactNode } from 'react'
import type { BasWorkspace } from '../bas/useBasWorkspace'
import { useWorkspace } from '../bas/BasWorkspaceContext'
import type { AgentConnectionAdapter } from './ConnectionRuntime'
import { connectionRuntime } from './ConnectionRuntime'
import { createBaskstreamWriteTools } from './baskstreamWriteTools'

const CONNECTION_ID = 'niagara-baskstream'

/** Plugin provider that owns the baskStream adapter lifecycle. */
export function BaskstreamAgentConnectionProvider({ children }: { children: ReactNode }) {
	const workspace = useWorkspace()
	useEffect(() => connectionRuntime.register(createBaskstreamAgentAdapter(workspace)), [
		workspace.browse,
		workspace.capabilities,
		workspace.connectedProfile,
		workspace.readPoints,
		workspace.search,
		workspace.status,
		workspace.sessionId,
		workspace.request,
		workspace.requestForSession,
	])
	return children
}

export function createBaskstreamAgentAdapter(workspace: BasWorkspace): AgentConnectionAdapter {
	const availableOperations = new Set(workspace.capabilities?.operations ?? [])
	const supports = (operation: string) => availableOperations.size === 0 || availableOperations.has(operation)

	const connected = workspace.status === 'connected'
	// Write tools are bound to a live station session; without one they are not offered.
	const sessionId = connected ? workspace.sessionId : ''
	const operations = [...availableOperations]
	const tools = createBaskstreamWriteTools(operations, (op, fields) => workspace.requestForSession(sessionId, op, fields))
		.filter((tool) => tool.effect === 'read' || Boolean(sessionId))

	return {
		id: CONNECTION_ID,
		sessionId,
		knowledgeScopeIds: workspace.connectedProfile ? [workspace.connectedProfile.alias] : [],
		type: 'baskstream',
		label: workspace.connectedProfile
			? `Niagara: ${workspace.connectedProfile.name}`
			: 'Niagara via baskStream',
		connected,
		capabilities: operations,
		auditIdentity: workspace.connectedProfile ? {
			stationAlias: workspace.connectedProfile.alias,
			stationEndpoint: redactEndpoint(workspace.connectedProfile.stationUrl),
		} : undefined,
		approvalCopy: { title: 'Allow Niagara station change?', previewLabel: 'Current station state' },
		tools: [
			...tools,
			...(supports('browse') ? [{
				id: 'browse',
				description: 'Browse one level of the Niagara station tree from an ORD or slot path.',
				capability: 'browse',
				effect: 'read' as const,
				inputSchema: { base: 'string, optional, defaults to slot:/' },
				execute: async (input: Record<string, JsonValue>) => workspace.browse(optionalString(input.base) || 'slot:/'),
			}] : []),
			...(supports('search') ? [{
				id: 'search',
				description: 'Search Niagara control points by name below a base ORD.',
				capability: 'search',
				effect: 'read' as const,
				inputSchema: {
					query: 'string, required',
					base: 'string, optional, defaults to slot:/',
					limit: 'number, optional, 1 to 100',
				},
				execute: async (input: Record<string, JsonValue>) => {
					const query = requiredString(input.query, 'query')
					const limit = boundedInteger(input.limit, 1, 100, 50)
					return (await workspace.search(query, optionalString(input.base) || 'slot:/')).slice(0, limit)
				},
			}] : []),
			...(supports('read') ? [{
				id: 'read',
				description: 'Read current values, display values, status, timestamps and types for Niagara points.',
				capability: 'read',
				effect: 'read' as const,
				inputSchema: { points: 'array of 1 to 100 ORD or slot-path strings, required' },
				execute: async (input: Record<string, JsonValue>) => workspace.readPoints(stringArray(input.points, 'points', 100)),
			}] : []),
		],
	}
}

/** Scheme, host, port and path only: never user info, query or fragment. */
function redactEndpoint(url: string) {
	try {
		const parsed = new URL(url)
		return `${parsed.protocol}//${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}`
	} catch {
		return undefined
	}
}

function optionalString(value: JsonValue | undefined) {
	return typeof value === 'string' ? value.trim() : ''
}

function requiredString(value: JsonValue | undefined, name: string) {
	const result = optionalString(value)
	if (!result) throw new Error(`${name} is required.`)
	return result
}

function boundedInteger(value: JsonValue | undefined, min: number, max: number, fallback: number) {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
	return Math.max(min, Math.min(max, Math.floor(value)))
}

function stringArray(value: JsonValue | undefined, name: string, max: number) {
	if (!Array.isArray(value)) throw new Error(`${name} must be an array.`)
	const result = value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
	if (result.length === 0) throw new Error(`${name} must include at least one point.`)
	if (result.length > max) throw new Error(`${name} cannot include more than ${max} points.`)
	return [...new Set(result)]
}
