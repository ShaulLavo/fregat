import ts from 'typescript'
import type * as lsp from 'vscode-languageserver-protocol'
import type { DocumentContext } from './context'
import { textEdits } from './edits'
import { isRecord, positionParam, rangeParam, stringParam } from './protocol'

export const ON_TYPE_FORMATTING_FIRST_TRIGGER = ';'
export const ON_TYPE_FORMATTING_MORE_TRIGGERS = ['}', '\n']

/** TypeScript's defaults with two-space indentation, until a request says what the editor uses. */
export function defaultFormatSettings(): ts.FormatCodeSettings {
  return {
    ...ts.getDefaultFormatCodeSettings('\n'),
    indentSize: 2,
    tabSize: 2,
    convertTabsToSpaces: true,
    semicolons: ts.SemicolonPreference.Ignore,
  }
}

/**
 * Settings for one request: the editor's indentation from the request's options over what the host
 * configured, and the document's own line ending so an edit does not introduce a second one.
 */
export function formatSettingsFor(
  base: ts.FormatCodeSettings,
  params: unknown,
  text: string,
): ts.FormatCodeSettings {
  const settings: ts.FormatCodeSettings = {
    ...base,
    newLineCharacter: text.includes('\r\n') ? '\r\n' : '\n',
  }
  const options = isRecord(params) && isRecord(params.options) ? params.options : null
  if (!options) return settings

  if (typeof options.tabSize === 'number') {
    settings.tabSize = options.tabSize
    settings.indentSize = options.tabSize
  }
  if (typeof options.insertSpaces === 'boolean') settings.convertTabsToSpaces = options.insertSpaces
  return settings
}

export function formatting(ctx: DocumentContext): lsp.TextEdit[] {
  const changes = ctx.env.languageService.getFormattingEditsForDocument(
    ctx.document.fileName,
    ctx.formatSettings,
  )
  return textEdits(ctx, ctx.document.fileName, changes)
}

export function rangeFormatting(ctx: DocumentContext, params: unknown): lsp.TextEdit[] {
  const range = rangeParam(params)
  if (!range) return []

  const changes = ctx.env.languageService.getFormattingEditsForRange(
    ctx.document.fileName,
    ctx.lines.offset(range.start),
    ctx.lines.offset(range.end),
    ctx.formatSettings,
  )
  return textEdits(ctx, ctx.document.fileName, changes)
}

export function onTypeFormatting(ctx: DocumentContext, params: unknown): lsp.TextEdit[] {
  const position = positionParam(params)
  const key = stringParam(params, 'ch')
  if (!position || !key) return []

  const changes = ctx.env.languageService.getFormattingEditsAfterKeystroke(
    ctx.document.fileName,
    ctx.lines.offset(position),
    key,
    ctx.formatSettings,
  )
  return textEdits(ctx, ctx.document.fileName, changes)
}
