import { describe, expect, it } from 'vitest'
import { diagnosticHighlightGroups, summarizeDiagnostics } from '../src/diagnostics'
import type * as lsp from 'vscode-languageserver-protocol'

import { snapshotDocument } from './snapshotDocument'

describe('language server diagnostics', () => {
  it('counts diagnostics by severity', () => {
    const diagnostics = [
      diagnostic(1, 0, 0, 1),
      diagnostic(2, 0, 1, 2),
      diagnostic(3, 0, 2, 3),
      diagnostic(4, 0, 3, 4),
    ]

    expect(summarizeDiagnostics('file:///src/index.ts', 3, diagnostics).counts).toEqual({
      error: 1,
      warning: 1,
      information: 1,
      hint: 1,
      total: 4,
    })
  })

  it('groups highlight ranges and expands empty ranges to a visible character', () => {
    const groups = diagnosticHighlightGroups(snapshotDocument('abc'), [
      diagnostic(1, 0, 0, 1),
      diagnostic(2, 0, 3, 3),
    ])

    expect(groups.error).toEqual([{ start: 0, end: 1 }])
    expect(groups.warning).toEqual([{ start: 2, end: 3 }])
  })

  it('keeps deprecated hints and replaces unnecessary hint washes with a fade layer', () => {
    const groups = diagnosticHighlightGroups(snapshotDocument('abcdef'), [
      { ...diagnostic(4, 0, 0, 3), tags: [2] },
      { ...diagnostic(4, 0, 3, 6), tags: [1] },
    ])

    expect(groups.hint).toEqual([{ start: 0, end: 3 }])
    expect(groups.unnecessary).toEqual([{ start: 3, end: 6 }])
    expect(groups.deprecated).toEqual([{ start: 0, end: 3 }])
  })

  it('combines unnecessary and deprecated tags while retaining error severity paint', () => {
    const groups = diagnosticHighlightGroups(snapshotDocument('abcdef'), [
      { ...diagnostic(1, 0, 0, 3), tags: [1, 2] },
      { ...diagnostic(4, 0, 3, 6), tags: [1, 2] },
    ])
    expect(groups.error).toEqual([{ start: 0, end: 3 }])
    expect(groups.hint).toEqual([])
    expect(groups.unnecessary).toEqual([
      { start: 0, end: 3 },
      { start: 3, end: 6 },
    ])
    expect(groups.deprecated).toEqual(groups.unnecessary)
  })

  it('does not create highlights for empty diagnostics in empty files', () => {
    const groups = diagnosticHighlightGroups(snapshotDocument(''), [diagnostic(1, 0, 0, 0)])

    expect(groups.error).toEqual([])
  })
})

function diagnostic(
  severity: lsp.DiagnosticSeverity,
  line: number,
  start: number,
  end: number,
): lsp.Diagnostic {
  return {
    severity,
    source: 'lsp-plugin',
    message: 'message',
    range: {
      start: { line, character: start },
      end: { line, character: end },
    },
  }
}
