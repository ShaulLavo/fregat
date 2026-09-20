import { locationForTextSpan } from '../shared/boundary'

import type * as lsp from 'vscode-languageserver-protocol'

import { documentText, lspPositionToOffset, textDocumentPosition } from '../shared/boundary'

import type { SessionContext } from '../shared/context'

export function handleReferences(ctx: SessionContext, params: unknown): lsp.Location[] {
  const request = textDocumentPosition(ctx, params)
  if (!request) return []

  const text = documentText(ctx, request.fileName)
  if (text === null) return []

  const offset = lspPositionToOffset(text, request.position)
  const references =
    ctx.getLanguageService().getReferencesAtPosition(request.fileName, offset) ?? []
  return references.flatMap((reference) =>
    locationForTextSpan(ctx, reference.fileName, reference.textSpan),
  )
}
