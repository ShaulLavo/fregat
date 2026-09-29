import { lspPositionToOffsetInSnapshot, type LspTextDocumentSnapshot } from '@singapore-editor/lsp'
import type * as lsp from 'vscode-languageserver-protocol'

import type { LanguageServerDiagnosticSummary, LanguageServerDiagnosticsFreshness } from './types'

export type LanguageServerDiagnosticSeverity = 'error' | 'warning' | 'information' | 'hint'

export type LanguageServerDiagnosticHighlightLayer =
  | LanguageServerDiagnosticSeverity
  | 'deprecated'
  | 'unnecessary'

export type LanguageServerDiagnosticHighlightGroups = Readonly<
  Record<LanguageServerDiagnosticHighlightLayer, readonly DiagnosticHighlightRange[]>
>

type DiagnosticHighlightRange = {
  readonly start: number
  readonly end: number
}

const ERROR = 1
const WARNING = 2
const INFORMATION = 3
const HINT = 4

const DIAGNOSTIC_TAG_UNNECESSARY = 1
const DIAGNOSTIC_TAG_DEPRECATED = 2

export function summarizeDiagnostics(
  uri: lsp.DocumentUri | null,
  version: number | null,
  diagnostics: readonly lsp.Diagnostic[],
  freshness: LanguageServerDiagnosticsFreshness = 'current',
): LanguageServerDiagnosticSummary {
  const counts = { error: 0, warning: 0, information: 0, hint: 0 }
  for (const diagnostic of diagnostics) counts[severityForDiagnostic(diagnostic)] += 1
  return {
    uri,
    version,
    diagnostics,
    counts: {
      ...counts,
      total: diagnostics.length,
    },
    freshness,
  }
}

const FRESHNESS_PRECEDENCE: readonly LanguageServerDiagnosticsFreshness[] = [
  'awaiting',
  'refreshing',
  'current',
  'silent',
  'unavailable',
]

/** Several servers on one document: any answer still coming outranks the ones that arrived. */
export function combineDiagnosticsFreshness(
  values: readonly LanguageServerDiagnosticsFreshness[],
): LanguageServerDiagnosticsFreshness {
  for (const freshness of FRESHNESS_PRECEDENCE) if (values.includes(freshness)) return freshness
  return 'silent'
}

export function diagnosticHighlightGroups(
  document: LspTextDocumentSnapshot,
  diagnostics: readonly lsp.Diagnostic[],
): LanguageServerDiagnosticHighlightGroups {
  const groups = emptyHighlightGroups()

  for (const diagnostic of diagnostics) {
    const range = highlightRangeForDiagnostic(document, diagnostic)
    if (!range) continue
    const unnecessary = diagnostic.tags?.includes(DIAGNOSTIC_TAG_UNNECESSARY)
    const severity = severityForDiagnostic(diagnostic)
    if (!unnecessary || severity !== 'hint') groups[severity].push(range)
    if (unnecessary) groups.unnecessary.push(range)
    if (diagnostic.tags?.includes(DIAGNOSTIC_TAG_DEPRECATED)) groups.deprecated.push(range)
  }

  return groups
}

function highlightRangeForDiagnostic(
  document: LspTextDocumentSnapshot,
  diagnostic: lsp.Diagnostic,
): DiagnosticHighlightRange | null {
  const start = lspPositionToOffsetInSnapshot(document, diagnostic.range.start)
  const end = lspPositionToOffsetInSnapshot(document, diagnostic.range.end)
  if (end > start) return { start, end }
  return expandEmptyRange(document.textSnapshot.length, start)
}

function expandEmptyRange(length: number, offset: number): DiagnosticHighlightRange | null {
  if (length === 0) return null
  if (offset < length) return { start: offset, end: offset + 1 }
  if (offset > 0) return { start: offset - 1, end: offset }
  return null
}

function emptyHighlightGroups(): Record<
  LanguageServerDiagnosticHighlightLayer,
  DiagnosticHighlightRange[]
> {
  return {
    error: [],
    warning: [],
    information: [],
    hint: [],
    deprecated: [],
    unnecessary: [],
  }
}

function severityForDiagnostic(diagnostic: lsp.Diagnostic): LanguageServerDiagnosticSeverity {
  if (diagnostic.severity === WARNING) return 'warning'
  if (diagnostic.severity === INFORMATION) return 'information'
  if (diagnostic.severity === HINT) return 'hint'
  if (diagnostic.severity === ERROR) return 'error'
  return 'error'
}
