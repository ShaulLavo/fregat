import { offsetToLspPosition } from '@singapore-editor/lsp/positions'
import ts from 'typescript'
import type * as lsp from 'vscode-languageserver-protocol'

const WARNING = 2
const INFORMATION = 3
const HINT = 4

const DIAGNOSTIC_TAG_UNNECESSARY = 1
const DIAGNOSTIC_TAG_DEPRECATED = 2

export function tsDiagnosticToLspDiagnostic(
  diagnostic: ts.Diagnostic,
  text = diagnostic.file?.text ?? '',
): lsp.Diagnostic {
  const start = clampDiagnosticOffset(diagnostic.start ?? 0, text)
  const end = clampDiagnosticOffset(start + (diagnostic.length ?? 0), text)

  const tags = lspTagsForTsDiagnostic(diagnostic)
  return {
    range: {
      start: offsetToLspPosition(text, start),
      end: offsetToLspPosition(text, end),
    },
    severity: lspSeverityForTsDiagnostic(diagnostic),
    code: diagnostic.code,
    source: 'typescript',
    message: tsDiagnosticMessageText(diagnostic),
    ...(tags.length > 0 && { tags }),
  }
}

export function tsDiagnosticMessageText(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
}

function lspSeverityForTsDiagnostic(diagnostic: ts.Diagnostic): lsp.DiagnosticSeverity {
  if (diagnostic.category === ts.DiagnosticCategory.Warning) return WARNING
  if (diagnostic.category === ts.DiagnosticCategory.Suggestion) return HINT
  if (diagnostic.category === ts.DiagnosticCategory.Message) return INFORMATION
  return 1
}

function lspTagsForTsDiagnostic(diagnostic: ts.Diagnostic): lsp.DiagnosticTag[] {
  const tags: lsp.DiagnosticTag[] = []
  if (diagnostic.reportsUnnecessary) tags.push(DIAGNOSTIC_TAG_UNNECESSARY)
  if (diagnostic.reportsDeprecated) tags.push(DIAGNOSTIC_TAG_DEPRECATED)
  return tags
}

function clampDiagnosticOffset(offset: number, text: string): number {
  return Math.min(text.length, Math.max(0, offset))
}
