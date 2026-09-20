import { locationForTextSpan } from '../shared/boundary'

import type * as lsp from 'vscode-languageserver-protocol'

import { documentText, lspPositionToOffset, textDocumentPosition } from '../shared/boundary'

import type { SessionContext } from '../shared/context'

export function handleDefinition(ctx: SessionContext, params: unknown): lsp.Location[] {
  const request = textDocumentPosition(ctx, params)
  if (!request) return []

  const text = documentText(ctx, request.fileName)
  if (text === null) return []

  const service = ctx.getLanguageService()
  const offset = lspPositionToOffset(text, request.position)
  const definitions =
    service.getDefinitionAndBoundSpan(request.fileName, offset)?.definitions ??
    service.getDefinitionAtPosition(request.fileName, offset) ??
    []

  return definitions.flatMap((definition) =>
    locationForTextSpan(ctx, definition.fileName, definition.textSpan),
  )
}
