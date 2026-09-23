// Runs one extraction in a forked child process (see vector-import-server.mjs).
import { readFile } from 'node:fs/promises'
import { extractDocument } from './document-extract.mjs'
process.once('message', async ({ input, name, directory }) => {
	let message
	try { message = { result: await extractDocument(await readFile(input), name, directory) } }
	catch (error) { message = { error: error instanceof Error ? error.message : String(error) } }
	process.send(message, () => process.exit(0))
})
