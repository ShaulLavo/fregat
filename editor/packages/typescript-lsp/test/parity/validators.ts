import type * as lsp from 'vscode-languageserver-protocol'
import { isRecord, type ParityDiagnostic } from './contract'

export function records(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value) || !value.every(isRecord)) return []
  return value
}

export function hoverText(result: unknown): string {
  if (!isRecord(result)) return ''
  const contents = result.contents
  if (typeof contents === 'string') return contents
  if (isRecord(contents) && typeof contents.value === 'string') return contents.value
  if (!Array.isArray(contents)) return ''
  return contents.map(markedStringText).join('\n')
}

function markedStringText(value: unknown): string {
  if (typeof value === 'string') return value
  return isRecord(value) && typeof value.value === 'string' ? value.value : ''
}

export function locationUris(result: unknown): readonly string[] {
  const entries = Array.isArray(result) ? records(result) : records([result])
  return entries.flatMap((entry) => {
    if (typeof entry.uri === 'string' && isRange(entry.range)) return [entry.uri]
    if (
      typeof entry.targetUri === 'string' &&
      isRange(entry.targetRange) &&
      isRange(entry.targetSelectionRange)
    ) {
      return [entry.targetUri]
    }
    return []
  })
}

export function completionItems(result: unknown): readonly Record<string, unknown>[] {
  const entries = Array.isArray(result)
    ? records(result)
    : records(isRecord(result) ? result.items : null)
  return entries.every((item) => typeof item.label === 'string') ? entries : []
}

export function editedUris(edit: unknown): readonly string[] {
  if (!isRecord(edit)) return []
  const changes = edit.changes
  if (isRecord(changes)) {
    return Object.keys(changes).filter((uri) => hasTextEdits(changes[uri]))
  }
  return records(edit.documentChanges).flatMap((change) =>
    isRecord(change.textDocument) &&
    typeof change.textDocument.uri === 'string' &&
    hasTextEdits(change.edits)
      ? [change.textDocument.uri]
      : [],
  )
}

export function hasTextEdits(value: unknown): boolean {
  const edits = records(value)
  return (
    edits.length > 0 &&
    edits.every((edit) => typeof edit.newText === 'string' && isRange(edit.range))
  )
}

export function isRange(value: unknown): value is lsp.Range {
  if (!isRecord(value) || !isPosition(value.start) || !isPosition(value.end)) return false
  return (
    value.end.line > value.start.line ||
    (value.end.line === value.start.line && value.end.character >= value.start.character)
  )
}

function isPosition(value: unknown): value is lsp.Position {
  return (
    isRecord(value) &&
    Number.isInteger(value.line) &&
    Number.isInteger(value.character) &&
    typeof value.line === 'number' &&
    value.line >= 0 &&
    typeof value.character === 'number' &&
    value.character >= 0
  )
}

export function diagnosticsFromReport(result: unknown): readonly ParityDiagnostic[] {
  if (!isRecord(result) || result.kind !== 'full') return []
  return records(result.items).flatMap((item) => {
    if (!isRange(item.range) || typeof item.message !== 'string') return []
    if (item.code !== undefined && typeof item.code !== 'string' && typeof item.code !== 'number')
      return []
    return [
      {
        range: item.range,
        message: item.message,
        code: item.code,
      },
    ]
  })
}

export function hasSemanticTokens(result: unknown): boolean {
  if (!isRecord(result) || !Array.isArray(result.data)) return false
  return (
    result.data.length > 0 &&
    result.data.length % 5 === 0 &&
    result.data.every(
      (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0,
    )
  )
}
