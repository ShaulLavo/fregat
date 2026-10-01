/** Small, real multipage PDFs with selectable text and an inert scripting action. */
export function makePdf(
  pages: readonly string[] = ['PDF verification first page', 'PDF verification second page'],
  font = 'Helvetica',
  userUnit = 1,
) {
  const objects: string[] = []
  const kids = pages.map((_, index) => `${4 + index * 2} 0 R`).join(' ')
  objects.push(
    '<< /Type /Catalog /Pages 2 0 R /OpenAction << /S /JavaScript /JS (globalThis.pdfScriptExecuted=true) >> >>',
  )
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`)
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /${font} >>`)
  for (const [index, text] of pages.entries()) {
    const stream = `BT /F1 24 Tf 50 720 Td (${text.replace(/[\\()]/g, '\\$&')}) Tj ET`
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /UserUnit ${userUnit} /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
    )
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  }
  let pdf = '%PDF-1.7\n%\x80\x80\x80\x80\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const start = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`
  return Uint8Array.from(pdf, (character) => character.charCodeAt(0))
}
