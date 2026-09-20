import { isRecord } from '@workspace/utils/objects'
import ts from 'typescript-language-service'
import type * as lsp from 'vscode-languageserver-protocol'

import {
  documentText,
  fileNameForUri,
  lspPositionToOffset,
  textDocumentPositionParams,
} from '../shared/boundary'
import type { SessionContext } from '../shared/context'
import { workspaceEditFromFileTextChanges } from './workspace-edit'

export function handleRename(ctx: SessionContext, params: unknown): lsp.WorkspaceEdit | null {
  const request = renameParams(params)
  if (!request) return null

  const fileName = fileNameForUri(ctx, request.uri)
  if (!fileName) return null

  const text = documentText(ctx, fileName)
  if (text === null) return null

  const offset = lspPositionToOffset(text, request.position)
  const locations =
    ctx.getLanguageService().findRenameLocations(fileName, offset, false, false, {
      providePrefixAndSuffixTextForRename: true,
    }) ?? []
  return workspaceEditFromFileTextChanges(ctx, renameFileTextChanges(locations, request.newName))
}

function renameFileTextChanges(
  locations: readonly ts.RenameLocation[],
  newName: string,
): readonly ts.FileTextChanges[] {
  return locations.map((location) => ({
    fileName: location.fileName,
    textChanges: [
      {
        newText: `${location.prefixText ?? ''}${newName}${location.suffixText ?? ''}`,
        span: location.textSpan,
      },
    ],
  }))
}

function renameParams(params: unknown): {
  uri: lsp.DocumentUri
  position: lsp.Position
  newName: string
} | null {
  const request = textDocumentPositionParams(params)
  if (!request) return null
  if (!isRecord(params)) return null
  if (typeof params.newName !== 'string') return null
  return { ...request, newName: params.newName }
}
