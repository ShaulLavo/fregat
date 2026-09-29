import ts from 'typescript'
import type * as lsp from 'vscode-languageserver-protocol'
import type { DocumentContext } from './context'
import { positionParam } from './protocol'

export function hover(ctx: DocumentContext, params: unknown): lsp.Hover | null {
  const position = positionParam(params)
  if (!position) return null

  const quickInfo = ctx.env.languageService.getQuickInfoAtPosition(
    ctx.document.fileName,
    ctx.lines.offset(position),
  )
  if (!quickInfo) return null

  const display = ts.displayPartsToString(quickInfo.displayParts ?? [])
  return {
    contents: {
      kind: 'markdown',
      value: documentationMarkdown(display, quickInfo.documentation, quickInfo.tags),
    },
    range: ctx.lines.range(quickInfo.textSpan),
  }
}

/** A signature fenced as TypeScript, then its prose, then its tags; empty parts are left out. */
export function documentationMarkdown(
  display: string,
  documentation: ts.SymbolDisplayPart[] | undefined,
  tags: readonly ts.JSDocTagInfo[] | undefined,
): string {
  const prose = ts.displayPartsToString(documentation ?? [])
  const tagLines = tags?.map(tagText).filter((tag) => tag.length > 0) ?? []
  const sections: string[] = []
  if (display) sections.push(['```ts', display, '```'].join('\n'))
  if (prose) sections.push(prose)
  if (tagLines.length > 0) sections.push(tagLines.join('\n'))
  return sections.join('\n\n')
}

function tagText(tag: ts.JSDocTagInfo): string {
  const text = ts.displayPartsToString(tag.text ?? [])
  if (!text) return `@${tag.name}`
  return `@${tag.name} ${text}`
}
