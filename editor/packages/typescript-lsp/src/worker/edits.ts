import type ts from 'typescript'
import type * as lsp from 'vscode-languageserver-protocol'
import type { ServiceContext } from './context'

export function textEdits(
  ctx: ServiceContext,
  fileName: string,
  changes: readonly ts.TextChange[],
): lsp.TextEdit[] {
  const lines = ctx.linesOf(fileName)
  if (!lines) return []

  return changes.map((change) => ({ range: lines.range(change.span), newText: change.newText }))
}

/**
 * One edit for every file TypeScript changes. A file TypeScript marks new is created before it is
 * written, because a text edit against a document that does not exist has nothing to apply to.
 */
export function workspaceEdit(
  ctx: ServiceContext,
  fileChanges: readonly ts.FileTextChanges[],
): lsp.WorkspaceEdit {
  if (!ctx.documentChanges) return legacyWorkspaceEdit(ctx, fileChanges)

  const documentChanges: (lsp.TextDocumentEdit | lsp.CreateFile)[] = []
  for (const change of mergeByFile(fileChanges)) {
    const uri = ctx.uriOf(change.fileName)
    if (change.isNewFile) {
      documentChanges.push({ kind: 'create', uri, options: { ignoreIfExists: true } })
      documentChanges.push({
        textDocument: { uri, version: null },
        edits: [{ range: emptyRange(), newText: newFileText(change) }],
      })
      continue
    }

    const edits = textEdits(ctx, change.fileName, change.textChanges)
    if (edits.length === 0) continue
    documentChanges.push({ textDocument: { uri, version: ctx.versionOf(uri) }, edits })
  }
  return { documentChanges }
}

function legacyWorkspaceEdit(
  ctx: ServiceContext,
  fileChanges: readonly ts.FileTextChanges[],
): lsp.WorkspaceEdit {
  const changes: Record<lsp.DocumentUri, lsp.TextEdit[]> = {}
  for (const change of mergeByFile(fileChanges)) {
    const edits = change.isNewFile
      ? [{ range: emptyRange(), newText: newFileText(change) }]
      : textEdits(ctx, change.fileName, change.textChanges)
    changes[ctx.uriOf(change.fileName)] = edits
  }
  return { changes }
}

/** TypeScript can name one file twice, and a client applies each entry against the original text. */
function mergeByFile(fileChanges: readonly ts.FileTextChanges[]): readonly ts.FileTextChanges[] {
  const merged = new Map<string, ts.FileTextChanges>()
  for (const change of fileChanges) {
    const existing = merged.get(change.fileName)
    if (!existing) {
      merged.set(change.fileName, change)
      continue
    }
    merged.set(change.fileName, {
      ...existing,
      isNewFile: existing.isNewFile === true || change.isNewFile === true,
      textChanges: [...existing.textChanges, ...change.textChanges],
    })
  }
  return Array.from(merged.values())
}

function newFileText(change: ts.FileTextChanges): string {
  return change.textChanges.map((textChange) => textChange.newText).join('')
}

function emptyRange(): lsp.Range {
  return { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }
}
