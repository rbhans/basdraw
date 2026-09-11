import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const exec = promisify(execFile)
export const MAX_PDF_BYTES = 25 * 1024 * 1024
export async function convertVectorPdf(bytes, page = 1) {
	if (!Number.isInteger(page) || page < 1 || page > 10000) throw new Error('Choose a valid page number.')
	if (bytes.length > MAX_PDF_BYTES) throw new Error('PDF files must be 25 MB or smaller.')
	if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('This file is not a PDF.')
	const directory = await mkdtemp(path.join(tmpdir(), 'basdraw-pdf-'))
	try {
		const input = path.join(directory, 'input.pdf'), output = path.join(directory, 'page.svg')
		await writeFile(input, bytes)
		const { stdout } = await exec('pdfinfo', [input], { timeout: 10000, maxBuffer: 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } })
		const pages = Number(/^Pages:\s+(\d+)/m.exec(stdout)?.[1])
		if (!pages || page > pages) throw new Error(`Choose a page between 1 and ${pages || '?'}.`)
		await exec('pdftocairo', ['-svg', '-f', String(page), '-l', String(page), input, output], { timeout: 30000, maxBuffer: 1024 * 1024 })
		if ((await stat(output)).size > 20 * 1024 * 1024) throw new Error('This page is too complex (over 20 MB of vectors). Simplify the PDF first.')
		return { svg: await readFile(output, 'utf8'), pages, page }
	} catch (error) {
		if (error.code === 'ENOENT') throw new Error('PDF import needs Poppler on this computer. On macOS: brew install poppler. Then restart the PDF import service.')
		if (error.killed) throw new Error('PDF conversion timed out. Try a simpler page.')
		if (error.stderr) throw new Error('Could not read this PDF. Check that it is valid and not password-protected.')
		throw error
	} finally {
		// Only remove the task-owned directory created above, never a caller-supplied path.
		await rm(directory, { recursive: true, force: true })
	}
}
