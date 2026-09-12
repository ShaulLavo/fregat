import { checkpointRequest } from '@/lib/documents/utils/comparisons'
import type { DocumentRef, GitComparison } from '@/lib/documents/utils/types'

export function encodedSettingsTab(): string {
  return 'settings:'
}

export function encodedViewTarget(
  document: Exclude<DocumentRef, { readonly kind: 'file' }>,
): string {
  switch (document.kind) {
    case 'settings-json':
      return `settings-json:${document.target}`
    case 'conflict':
      return `conflict-diff:${encodeURIComponent(document.conflictId)}`
    case 'compare-saved':
      return `compare-saved:${encodeURIComponent(document.file.path)}`
    case 'search':
      return `search-buffer:${encodeURIComponent(document.root)}`
    case 'git-ref':
      return `git-ref:${encodeURIComponent(JSON.stringify({ path: document.source.path, ref: document.source.ref, version: 1 }))}`
    case 'git-diff':
      return encodedComparison(document.source)
    default: {
      const exhaustive: never = document
      return exhaustive
    }
  }
}

function encodedComparison(source: GitComparison): string {
  if (source.kind === 'snapshot') {
    const { newObjectId, oldObjectId, oldPath, path, status } = source
    const payload = {
      newObjectId,
      oldObjectId,
      oldPath,
      path,
      source: source.source,
      status,
      version: 2,
    }
    return `git-diff:v2:${encodeURIComponent(JSON.stringify(payload))}`
  }
  const request = checkpointRequest(source)
  const payload = {
    filePath: source.kind === 'checkpoint-file' ? source.file.path : undefined,
    fromTurnCount: source.fromTurnCount,
    newObjectId: source.newObjectId,
    oldObjectId: source.oldObjectId,
    oldPath: source.oldPath,
    path: request.path,
    scope: request.scope,
    status: source.status,
    sessionId: source.sessionId,
    toTurnCount: source.toTurnCount,
    version: 1,
  }
  return `git-diff:checkpoint-v1:${encodeURIComponent(JSON.stringify(payload))}`
}
