import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const vite = path.join(root, 'node_modules', '.bin', 'vite')
const children = [
	spawn(process.execPath, [path.join(root, 'scripts', 'vector-import-server.mjs')], { cwd: root, stdio: 'inherit' }),
	spawn(process.execPath, [path.join(root, 'scripts', 'baskstream-bridge.mjs')], {
		cwd: root,
		stdio: 'inherit',
	}),
	spawn(process.execPath, [path.join(root, 'scripts', 'codex-subscription-bridge.mjs')], {
		cwd: root,
		stdio: 'inherit',
	}),
	spawn(vite, ['--host', '127.0.0.1'], { cwd: root, stdio: 'inherit' }),
]

let stopping = false

function stop(signal = 'SIGTERM') {
	if (stopping) return
	stopping = true
	for (const child of children) {
		if (!child.killed) child.kill(signal)
	}
}

for (const signal of ['SIGINT', 'SIGTERM']) {
	process.on(signal, () => stop(signal))
}

for (const child of children) {
	child.on('exit', (code, signal) => {
		if (!stopping) stop()
		if (signal) process.exitCode = 0
		else if (code) process.exitCode = code
	})
}
