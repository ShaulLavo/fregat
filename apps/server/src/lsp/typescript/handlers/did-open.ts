import { isTypeScriptFileName } from '../shared/file-type'

import { isRecord } from '@workspace/utils/objects'
import type * as lsp from 'vscode-languageserver-protocol'

import { fileNameForUri } from '../shared/boundary'
import type { SessionContext } from '../shared/context'

export function handleDidOpen(ctx: SessionContext, params: unknown): void {
  const textDocument = textDocumentItem(params)
  if (!textDocument) return

  const fileName = fileNameForUri(ctx, textDocument.uri)
  if (!fileName) return
  if (!isTypeScriptFileName(fileName)) return

  ctx.documents.set(textDocument.uri, {
    uri: textDocument.uri,
    fileName,
    languageId: textDocument.languageId,
    version: textDocument.version,
    text: textDocument.text,
  })
  ctx.bumpScriptVersion(fileName)
  ctx.invalidateForFileContentChange(fileName)
  ctx.scheduleDiagnostics(textDocument.uri)
}

function textDocumentItem(params: unknown): lsp.TextDocumentItem | null {
  if (!isRecord(params)) return null
  if (!isRecord(params.textDocument)) return null

  const textDocument = params.textDocument
  if (typeof textDocument.uri !== 'string') return null
  if (typeof textDocument.languageId !== 'string') return null
  if (typeof textDocument.version !== 'number') return null
  if (typeof textDocument.text !== 'string') return null
  return textDocument as unknown as lsp.TextDocumentItem
}
