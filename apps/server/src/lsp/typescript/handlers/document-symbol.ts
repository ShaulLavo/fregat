import { textDocumentIdentifier } from '../shared/boundary'

import ts from 'typescript-language-service'
import type * as lsp from 'vscode-languageserver-protocol'

import { documentText, fileNameForUri, rangeFromTextSpan } from '../shared/boundary'
import type { SessionContext } from '../shared/context'

export function handleDocumentSymbol(ctx: SessionContext, params: unknown): lsp.DocumentSymbol[] {
  const document = textDocumentIdentifier(params)
  if (!document) return []

  const fileName = fileNameForUri(ctx, document.uri)
  if (!fileName) return []

  const text = documentText(ctx, fileName)
  if (text === null) return []

  const tree = ctx.getLanguageService().getNavigationTree(fileName)
  return tree.childItems?.flatMap((item) => documentSymbol(item, text)) ?? []
}

function documentSymbol(
  item: ts.NavigationTree,
  fallbackText: string,
): readonly lsp.DocumentSymbol[] {
  const span = item.spans[0]
  if (!span) return []

  const range = rangeFromTextSpan(fallbackText, span)
  return [
    {
      name: item.text || '<anonymous>',
      kind: symbolKind(item.kind),
      range,
      selectionRange: range,
      children: item.childItems?.flatMap((child) => documentSymbol(child, fallbackText)),
    },
  ]
}

function symbolKind(kind: string): lsp.SymbolKind {
  if (kind === ts.ScriptElementKind.moduleElement) return 2
  if (kind === ts.ScriptElementKind.classElement) return 5
  if (kind === ts.ScriptElementKind.enumElement) return 10
  if (kind === ts.ScriptElementKind.interfaceElement) return 11
  if (kind === ts.ScriptElementKind.functionElement) return 12
  if (kind === ts.ScriptElementKind.memberFunctionElement) return 6
  if (kind === ts.ScriptElementKind.memberVariableElement) return 7
  if (kind === ts.ScriptElementKind.constElement) return 13
  if (kind === ts.ScriptElementKind.letElement) return 13
  return 13
}
