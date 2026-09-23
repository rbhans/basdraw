import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const vite = path.join(root, 'node_modules', '.bin', 'vite')
// A required component that exits during startup (e.g. port in use) stops everything.
// After startup only Vite exiting ends the session; the local servers are logged and
// the optional Codex bridge never takes the UI down.
const startupWindowMs = 5_000
const killGraceMs = 4_000
const components = [
	{ name: 'vector import', required: true, command: process.execPath, args: [path.join(root, 'scripts', 'vector-import-server.mjs')] },
	{ name: 'baskStream bridge', required: true, command: process.execPath, args: [path.join(root, 'scripts', 'baskstream-bridge.mjs')] },
	{ name: 'Codex bridge', required: false, command: process.execPath, args: [path.join(root, 'scripts', 'codex-subscription-bridge.mjs')] },
	{ name: 'Vite', required: true, primary: true, command: vite, args: ['--host', '127.0.0.1'] },
]
const startedAt = Date.now()
const children = components.map((component) => {
	const child = spawn(component.command, component.args, { cwd: root, stdio: 'inherit' })
	return { ...component, child }
})

let stopping = false

const isRunning = (child) => child.exitCode === null && child.signalCode === null

function stop(signal = 'SIGTERM') {
	if (stopping) return
	stopping = true
	for (const { child } of children) {
		if (isRunning(child)) child.kill(signal)
	}
	// Escalate for anything that ignores the first signal.
	setTimeout(() => {
		for (const { child } of children) {
			if (isRunning(child)) child.kill('SIGKILL')
		}
	}, killGraceMs).unref()
}

for (const signal of ['SIGINT', 'SIGTERM']) {
	process.on(signal, () => stop(signal))
}

for (const component of children) {
	const { child, name } = component
	child.on('error', (error) => {
		console.error(`[dev] ${name} failed to start: ${error.message}`)
		if (component.required && !stopping) {
			process.exitCode = 1
			stop()
		}
	})
	child.on('exit', (code, signal) => {
		if (stopping) return
		const duringStartup = Date.now() - startedAt < startupWindowMs
		if (component.primary || (component.required && duringStartup)) {
			if (!component.primary) console.error(`[dev] ${name} exited during startup${code ? ` with code ${code}` : ''}; stopping.`)
			if (!signal && code) process.exitCode = code
			stop()
			return
		}
		console.error(`[dev] ${name} exited${signal ? ` (${signal})` : ` with code ${code}`}. The rest of basdraw keeps running.`)
	})
}
