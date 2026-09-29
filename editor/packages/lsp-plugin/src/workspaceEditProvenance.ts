import type { ActiveDocument } from './pluginTypes'
import type { WorkspaceEditOriginGuard, WorkspaceTextDocumentProvenance } from './types'
import type { ParsedWorkspaceEdit } from './workspaceEdit'

export function currentWorkspaceEditOrigin(
  guard: WorkspaceEditOriginGuard,
  active: ActiveDocument,
  plan: ParsedWorkspaceEdit,
): WorkspaceTextDocumentProvenance | null {
  const origin = guard.documents.find((document) => document.uri === active.uri)
  if (!origin || origin.textSnapshot !== active.textSnapshot) return null
  if (!guard.isCurrent(active.uri)) return null

  const affectedUris = new Set(
    plan.operations.flatMap((operation) =>
      operation.kind === 'rename' ? [operation.oldUri, operation.newUri] : [operation.uri],
    ),
  )
  for (const document of guard.documents) {
    if (!affectedUris.has(document.uri)) continue
    if (!guard.isCurrent(document.uri)) return null
  }
  return origin
}
