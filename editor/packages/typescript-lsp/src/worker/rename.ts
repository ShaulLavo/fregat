import type ts from 'typescript'
import type * as lsp from 'vscode-languageserver-protocol'
import type { DocumentContext } from './context'
import { workspaceEdit } from './edits'
import { positionParam, REQUEST_FAILED, rpcError, stringParam } from './protocol'

/** Null where nothing can be renamed, so the client offers no prompt rather than an error. */
export function prepareRename(
  ctx: DocumentContext,
  params: unknown,
): { range: lsp.Range; placeholder: string } | null {
  const info = renameInfo(ctx, params)
  if (!info?.canRename) return null

  return { range: ctx.lines.range(info.triggerSpan), placeholder: info.displayName }
}

export function rename(ctx: DocumentContext, params: unknown): lsp.WorkspaceEdit | null {
  const position = positionParam(params)
  const newName = stringParam(params, 'newName')
  if (!position || newName === null) return null

  const offset = ctx.lines.offset(position)
  const info = ctx.env.languageService.getRenameInfo(ctx.document.fileName, offset, ctx.preferences)
  if (!info.canRename) throw rpcError(REQUEST_FAILED, info.localizedErrorMessage)

  const locations = ctx.env.languageService.findRenameLocations(
    ctx.document.fileName,
    offset,
    false,
    false,
    ctx.preferences,
  )
  if (!locations) return null

  return workspaceEdit(
    ctx,
    locations.map((location) => renameChange(location, newName)),
  )
}

function renameInfo(ctx: DocumentContext, params: unknown): ts.RenameInfo | null {
  const position = positionParam(params)
  if (!position) return null

  return ctx.env.languageService.getRenameInfo(
    ctx.document.fileName,
    ctx.lines.offset(position),
    ctx.preferences,
  )
}

/** The prefix and suffix keep a shorthand property or an import binding pointing where it did. */
function renameChange(location: ts.RenameLocation, newName: string): ts.FileTextChanges {
  return {
    fileName: location.fileName,
    textChanges: [
      {
        span: location.textSpan,
        newText: `${location.prefixText ?? ''}${newName}${location.suffixText ?? ''}`,
      },
    ],
  }
}
