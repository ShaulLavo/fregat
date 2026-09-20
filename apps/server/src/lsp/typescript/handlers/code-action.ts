import { isRecord } from '@workspace/utils/objects'
import ts from 'typescript-language-service'
import type * as lsp from 'vscode-languageserver-protocol'

import { documentText, fileNameForUri, lspPositionToOffset } from '../shared/boundary'
import type { SessionContext } from '../shared/context'
import { workspaceEditFromFileTextChanges } from './workspace-edit'

export function handleCodeAction(
  ctx: SessionContext,
  params: unknown,
): readonly (lsp.Command | lsp.CodeAction)[] {
  const request = codeActionParams(params)
  if (!request) return []

  const fileName = fileNameForUri(ctx, request.uri)
  if (!fileName) return []

  const text = documentText(ctx, fileName)
  if (text === null) return []

  const start = lspPositionToOffset(text, request.range.start)
  const end = lspPositionToOffset(text, request.range.end)
  const errorCodes = request.diagnostics.flatMap(diagnosticCode)
  if (errorCodes.length === 0) return []

  const fixes = ctx
    .getLanguageService()
    .getCodeFixesAtPosition(fileName, start, end, errorCodes, {}, {})
  return fixes.flatMap((fix) => codeActionFromFix(ctx, fix, request.diagnostics))
}

function codeActionFromFix(
  ctx: SessionContext,
  fix: ts.CodeFixAction,
  diagnostics: lsp.Diagnostic[],
): readonly lsp.CodeAction[] {
  const edit = workspaceEditFromFileTextChanges(ctx, fix.changes)
  if (!edit) return []

  return [
    {
      title: fix.description,
      kind: 'quickfix',
      diagnostics,
      edit,
    },
  ]
}

function codeActionParams(params: unknown): {
  uri: lsp.DocumentUri
  range: lsp.Range
  diagnostics: lsp.Diagnostic[]
} | null {
  if (!isRecord(params)) return null
  if (!isRecord(params.textDocument)) return null
  if (!isRecord(params.range)) return null
  if (!isRecord(params.context)) return null
  if (typeof params.textDocument.uri !== 'string') return null
  if (!isLspRange(params.range)) return null
  const diagnostics = params.context.diagnostics
  if (!Array.isArray(diagnostics)) return null

  return {
    uri: params.textDocument.uri,
    range: params.range,
    diagnostics,
  }
}

function isLspRange(value: Record<string, unknown>): value is lsp.Range {
  if (!isRecord(value.start)) return false
  if (!isRecord(value.end)) return false
  if (typeof value.start.line !== 'number') return false
  if (typeof value.start.character !== 'number') return false
  if (typeof value.end.line !== 'number') return false
  return typeof value.end.character === 'number'
}

function diagnosticCode(diagnostic: lsp.Diagnostic): readonly number[] {
  if (typeof diagnostic.code === 'number') return [diagnostic.code]
  if (typeof diagnostic.code !== 'string') return []
  const parsed = Number(diagnostic.code)
  return Number.isInteger(parsed) ? [parsed] : []
}
