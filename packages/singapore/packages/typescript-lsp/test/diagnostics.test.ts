import { createStringTextSnapshot } from '@singapore-editor/core/document'
import { arrayLspLineStarts, type LspTextDocumentSnapshot } from '@singapore-editor/lsp'
import { describe, expect, it } from 'vitest'
import { diagnosticHighlightGroups, summarizeDiagnostics } from '../src'
import type * as lsp from 'vscode-languageserver-protocol'

describe('TypeScript LSP diagnostics', () => {
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
    const groups = diagnosticHighlightGroups(singleLineDocument('abc'), [
      diagnostic(1, 0, 0, 1),
      diagnostic(2, 0, 3, 3),
    ])

    expect(groups.error).toEqual([{ start: 0, end: 1 }])
    expect(groups.warning).toEqual([{ start: 2, end: 3 }])
  })

  it('does not create highlights for empty diagnostics in empty files', () => {
    const groups = diagnosticHighlightGroups(singleLineDocument(''), [diagnostic(1, 0, 0, 0)])

    expect(groups.error).toEqual([])
  })
})

function singleLineDocument(text: string): LspTextDocumentSnapshot {
  return { textSnapshot: createStringTextSnapshot(text), lineStarts: arrayLspLineStarts([0]) }
}

function diagnostic(
  severity: lsp.DiagnosticSeverity,
  line: number,
  start: number,
  end: number,
): lsp.Diagnostic {
  return {
    severity,
    source: 'typescript',
    message: 'message',
    range: {
      start: { line, character: start },
      end: { line, character: end },
    },
  }
}
