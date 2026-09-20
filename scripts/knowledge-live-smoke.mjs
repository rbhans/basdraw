// Optional, explicit smoke test against the existing ChatGPT subscription bridge.
// Uses only synthetic context, has no canvas or station actions, and does not save chat history.
import assert from 'node:assert/strict'

const base = process.env.BASDRAW_SMOKE_URL || 'http://127.0.0.1:5173'
const projectId = process.env.BASDRAW_SMOKE_PROJECT
if (!projectId) throw new Error('Set BASDRAW_SMOKE_PROJECT to a project containing the synthetic verification note.')
const scope = { projectId, connectionId: null, pluginIds: ['niagara-baskstream'], connectionTypes: ['baskstream'], connectionIds: [] }
const loaded = []
const results = []
const completed = []
for (let round = 0; round < 5; round++) {
	const prompt = {
		mode: { type: 'mode', modeType: 'working', actionTypes: ['knowledge', 'message', 'connectionTool', 'create', 'update'], partTypes: ['messages', 'knowledgeScope', 'data', 'modelName'] },
		modelName: { type: 'modelName', modelName: 'codex-subscription', reasoningEffort: 'low' },
		knowledgeScope: { type: 'knowledgeScope', ...scope, loaded },
		messages: { type: 'messages', requestSource: 'user', agentMessages: ['This is a synthetic read-only retrieval test. Load the baskStream workflow skill, then find the temporary knowledge verification note in this project and read it. Report the exact test equipment label and which baskStream tool reads multiple points. Do not connect to a station or change anything. Do not repeat successful retrievals already in the supplied results.'] },
		data: { type: 'data', data: results },
	}
	const response = await fetch(`${base}/stream`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(prompt), signal: AbortSignal.timeout(90000) })
	assert.ok(response.ok, `Stream HTTP ${response.status}`)
	const text = await response.text()
	const actions = text.split('\n').filter((line) => line.startsWith('data: ')).map((line) => JSON.parse(line.slice(6)))
	const error = actions.find((action) => action.error)
	if (error) throw new Error(error.error)
	const finished = actions.filter((action) => action.complete)
	console.log(`Round ${round + 1}: ${finished.map((action) => `${action._type}:${action.operation || ''}`).join(', ')}`)
	completed.push(...finished)
	let retrieved = false
	for (const action of finished) {
		if (action._type !== 'knowledge') continue
		const retrieval = await fetch(`${base}/api/knowledge/retrieve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope, request: action }) })
		assert.ok(retrieval.ok, `Retrieval HTTP ${retrieval.status}: ${await retrieval.clone().text()}`)
		results.push({ kind: 'knowledge-result', operation: action.operation, id: action.id ?? null, ok: true, data: await retrieval.json() })
		if (['loadSkill', 'getReference'].includes(action.operation)) loaded.push({ operation: action.operation, id: action.id, offset: action.offset || 0 })
		retrieved = true
	}
	if (!retrieved) break
}
assert.ok(completed.some((action) => action.operation === 'loadSkill'), 'Agent must load the skill')
assert.ok(completed.some((action) => action.operation === 'getReference'), 'Agent must read the project reference')
const messages = completed.filter((action) => action._type === 'message').map((action) => action.text).join('\n')
assert.match(messages, /QA-AHU-42/)
assert.match(messages, /read/i)
console.log('PASS: subscription model loaded a skill, retrieved project knowledge, and answered from the retrieved evidence.')
