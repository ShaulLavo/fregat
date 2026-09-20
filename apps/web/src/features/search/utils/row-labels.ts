import type { WorkspaceSearchMatch } from '@workspace/contracts'

export function searchMatchLocation(match: WorkspaceSearchMatch) {
  if (match.kind === 'name') return 'name'
  if (match.line === undefined) return 'match'

  return String(match.line)
}

export function searchMatchOpenLabel(match: WorkspaceSearchMatch) {
  if (typeof match.line !== 'number') return 'Open result'
  if (typeof match.column !== 'number') return `Open result at line ${match.line}`

  return `Open result at line ${match.line}, column ${match.column}`
}

export function matchPreviewMaxLength(
  match: WorkspaceSearchMatch,
  previewMaxLength: number | undefined,
) {
  if (match.source !== 'open-buffer') return previewMaxLength
  if (previewMaxLength === undefined) return undefined

  return Math.max(12, previewMaxLength - 8)
}
