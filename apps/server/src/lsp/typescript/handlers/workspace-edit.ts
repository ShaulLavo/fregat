import ts from 'typescript-language-service'
import type * as lsp from 'vscode-languageserver-protocol'

import {
  documentTextSnapshot,
  documentUriForFileName,
  strictRangeFromTextSpan,
} from '../shared/boundary'
import { normalizeNativePath } from '../../../utils/path'
import { isInsidePath } from '../../../utils/path'
import type { SessionContext } from '../shared/context'

type PreparedFileChange = {
  readonly edits: lsp.TextEdit[]
  readonly isNewFile: boolean
  readonly uri: lsp.DocumentUri
  readonly version: number | null
}

type MutablePreparedFileChange = {
  readonly edits: lsp.TextEdit[]
  readonly isNewFile: boolean
  readonly text: string
  readonly uri: lsp.DocumentUri
  readonly version: number | null
}

export function workspaceEditFromFileTextChanges(
  ctx: SessionContext,
  changes: readonly ts.FileTextChanges[],
): lsp.WorkspaceEdit | null {
  const prepared = prepareFileChanges(ctx, changes)
  if (!prepared || prepared.length === 0) return null

  if (!ctx.workspaceEditCapabilities.documentChanges) return legacyWorkspaceEdit(prepared)
  if (!canRepresentResourceOperations(ctx, prepared)) return null

  return documentChangesWorkspaceEdit(prepared)
}

function prepareFileChanges(
  ctx: SessionContext,
  changes: readonly ts.FileTextChanges[],
): readonly PreparedFileChange[] | null {
  const prepared = new Map<string, MutablePreparedFileChange>()
  for (const change of changes) {
    if (!appendFileChange(ctx, prepared, change)) return null
  }

  return Array.from(prepared.values()).map(({ text: _text, ...change }) => change)
}

function appendFileChange(
  ctx: SessionContext,
  prepared: Map<string, MutablePreparedFileChange>,
  change: ts.FileTextChanges,
): boolean {
  if (typeof change.fileName !== 'string') return false
  if (!Array.isArray(change.textChanges)) return false
  if (change.isNewFile !== undefined && typeof change.isNewFile !== 'boolean') return false

  const fileName = normalizeNativePath(change.fileName)
  if (!isInsidePath(ctx.root, fileName)) return false

  const existing = prepared.get(fileName)
  const target = existing ?? prepareTarget(ctx, fileName, change.isNewFile === true)
  if (!target) return false
  if (existing && existing.isNewFile !== (change.isNewFile === true)) return false
  if (!appendTextChanges(target, change.textChanges)) return false

  prepared.set(fileName, target)
  return true
}

function prepareTarget(
  ctx: SessionContext,
  fileName: string,
  isNewFile: boolean,
): MutablePreparedFileChange | null {
  const uri = documentUriForFileName(ctx, fileName)
  if (isNewFile) return { edits: [], isNewFile, text: '', uri, version: null }

  const snapshot = documentTextSnapshot(ctx, fileName)
  if (!snapshot) return null
  return { edits: [], isNewFile, text: snapshot.text, uri, version: snapshot.version }
}

function appendTextChanges(
  target: MutablePreparedFileChange,
  changes: readonly ts.TextChange[],
): boolean {
  for (const change of changes) {
    if (typeof change.newText !== 'string') return false
    if (!change.span || typeof change.span !== 'object') return false

    const range = strictRangeFromTextSpan(target.text, change.span)
    if (!range) return false
    target.edits.push({ newText: change.newText, range })
  }

  return true
}

function canRepresentResourceOperations(
  ctx: SessionContext,
  changes: readonly PreparedFileChange[],
): boolean {
  if (!changes.some((change) => change.isNewFile)) return true
  return ctx.workspaceEditCapabilities.resourceOperations.includes('create')
}

function documentChangesWorkspaceEdit(changes: readonly PreparedFileChange[]): lsp.WorkspaceEdit {
  const documentChanges: NonNullable<lsp.WorkspaceEdit['documentChanges']> = []
  for (const change of changes) {
    if (change.isNewFile) documentChanges.push({ kind: 'create', uri: change.uri })
    documentChanges.push({
      edits: change.edits,
      textDocument: { uri: change.uri, version: change.version },
    })
  }

  return { documentChanges }
}

function legacyWorkspaceEdit(changes: readonly PreparedFileChange[]): lsp.WorkspaceEdit | null {
  if (changes.some((change) => change.isNewFile)) return null

  const result: Record<lsp.DocumentUri, lsp.TextEdit[]> = {}
  for (const change of changes) result[change.uri] = change.edits
  return { changes: result }
}
