import Papa from 'papaparse'
import type { TextEdit } from '@singapore-editor/core/document'

export type CsvCell = {
  readonly value: string
  readonly start: number
  readonly end: number
  readonly quoted: boolean
}

export type CsvTable = {
  readonly delimiter: string
  readonly rows: readonly (readonly CsvCell[])[]
}

export type CsvPresentation =
  | { readonly kind: 'table'; readonly table: CsvTable }
  | { readonly kind: 'error'; readonly message: string }

export function parseCsv(text: string): CsvPresentation {
  const delimiter = detectDelimiter(text)
  const parsed = Papa.parse<string[]>(text, {
    delimiter,
    skipEmptyLines: false,
    dynamicTyping: false,
  })
  const error = parsed.errors.find((item) => item.code !== 'UndetectableDelimiter')
  if (error) return { kind: 'error', message: `CSV row ${(error.row ?? 0) + 1}: ${error.message}` }
  if (text === '') return { kind: 'table', table: { delimiter: ',', rows: [] } }
  const spans = fieldSpans(text, parsed.meta.delimiter)
  if (spans.length !== parsed.data.length)
    return { kind: 'error', message: 'CSV row boundaries could not be read.' }
  const rows: CsvCell[][] = []
  for (const [index, values] of parsed.data.entries()) {
    const fields = spans[index]!
    if (fields.length !== values.length)
      return { kind: 'error', message: `CSV row ${index + 1} has unreadable field boundaries.` }
    rows.push(values.map((value, column) => ({ ...fields[column]!, value })))
  }
  return { kind: 'table', table: { delimiter: parsed.meta.delimiter, rows } }
}

export function csvCellEdit(cell: CsvCell, delimiter: string, value: string): TextEdit | null {
  if (value === cell.value) return null
  // Quote every detectable separator so an edited value cannot change delimiter inference.
  const quoted =
    cell.quoted ||
    value.includes(delimiter) ||
    value.includes(Papa.RECORD_SEP) ||
    value.includes(Papa.UNIT_SEP) ||
    /[,;|\t"\r\n]/u.test(value)
  const text = quoted ? `"${value.replaceAll('"', '""')}"` : value
  return { from: cell.start, to: cell.end, text }
}

function fieldSpans(text: string, delimiter: string) {
  const rows: Omit<CsvCell, 'value'>[][] = []
  let row: Omit<CsvCell, 'value'>[] = []
  let start = text.charCodeAt(0) === 0xfeff ? 1 : 0
  let inQuotes = false
  for (let offset = start; offset < text.length; offset++) {
    const char = text[offset]
    if (char === '"' && (offset === start || inQuotes)) {
      if (inQuotes && text[offset + 1] === '"') offset++
      else inQuotes = !inQuotes
      continue
    }
    if (inQuotes) continue
    const newline = char === '\r' || char === '\n'
    if (!newline && !text.startsWith(delimiter, offset)) continue
    row.push({ start, end: offset, quoted: text[start] === '"' })
    if (newline) {
      rows.push(row)
      row = []
      if (char === '\r' && text[offset + 1] === '\n') offset++
    } else offset += delimiter.length - 1
    start = offset + 1
  }
  row.push({ start, end: text.length, quoted: text[start] === '"' })
  rows.push(row)
  return rows
}

function detectDelimiter(text: string): string {
  let delimiter = ','
  let bestRows = 0
  let bestFields = 0
  // Ragged final records contribute no evidence against separators in the preceding records.
  for (const candidate of [',', '\t', '|', ';', Papa.RECORD_SEP, Papa.UNIT_SEP]) {
    const preview = Papa.parse<string[]>(text, {
      delimiter: candidate,
      preview: 10,
      skipEmptyLines: true,
    })
    const rows = preview.data.filter((row) => row.length > 1)
    const fields = rows.reduce((total, row) => total + row.length, 0)
    if (rows.length < bestRows || (rows.length === bestRows && fields <= bestFields)) continue
    delimiter = candidate
    bestRows = rows.length
    bestFields = fields
  }
  return delimiter
}
