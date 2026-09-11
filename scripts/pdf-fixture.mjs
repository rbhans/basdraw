// Small deterministic control drawing for converter and browser regression tests.
// Generated in memory: no customer documents or saved canvas are involved.
export function samplePdf({ raster = false } = {}) {
	const content = raster ? 'q 600 0 0 400 0 0 cm /Im1 Do Q' : `
0.15 0.15 0.15 RG 2 w
30 140 m 160 140 l S
300 140 m 500 140 l S
q 1 0 0 1 220 140 cm
0.1 0.55 0.3 rg
0 60 m 33 60 60 33 60 0 c 60 -33 33 -60 0 -60 c -33 -60 -60 -33 -60 0 c -60 33 -33 60 0 60 c B
0.15 0.15 0.15 rg
-45 -8 m 45 -8 l 45 8 l -45 8 l h f
-8 -45 m 8 -45 l 8 45 l -8 45 l h f
Q
q 400 220 70 40 re W n
0.2 0.4 0.8 rg 385 210 110 65 re f Q
q 0.866 0.5 -0.5 0.866 100 290 cm
0.7 0.2 0.2 RG 0 0 60 25 re S Q
BT /F1 16 Tf 30 355 Td (AHU-01 CONTROL DRAWING) Tj ET
BT /F1 12 Tf 177 60 Td (SUPPLY FAN) Tj ET
`
	const second = '0 0 1 rg 40 40 90 70 re f'
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] /Resources << /Font << /F1 5 0 R >> /XObject << /Im1 8 0 R >> >> /Contents 4 0 R >>',
		`<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << >> /Contents 7 0 R >>',
		`<< /Length ${second.length} >>\nstream\n${second}\nendstream`,
		'<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 7 >>\nstream\nFF0000>\nendstream',
	]
	let result = '%PDF-1.4\n', offsets = [0]
	objects.forEach((object, index) => { offsets.push(result.length); result += `${index + 1} 0 obj\n${object}\nendobj\n` })
	const xref = result.length
	result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
	return new TextEncoder().encode(result)
}
