/**
 * What a drag carries, as far as the composer is concerned.
 *
 * The workspace file tree drags a row as `text/plain` holding the row's
 * absolute path — it is a generic tree component and knows nothing about chat,
 * so there is no chat-specific MIME type to look for. The composer identifies
 * the drop by its content instead: a single-line absolute path inside the open
 * workspace is a file the user pointed at, and becomes a mention. Anything else
 * is text, and the editor's own drop handling keeps it.
 */
export type ComposerDropTransfer = {
  getData: (format: string) => string
  readonly types: readonly string[]
}

/** Drops the composer claims. Files are attachments; a workspace path is a mention. */
export function composerDropCarriesFiles(transfer: ComposerDropTransfer) {
  return transfer.types.includes('Files')
}

/**
 * The workspace-relative path a dragged row points at, or null when the drag is
 * not one. Relative because that is what a mention holds — the absolute path is
 * an artifact of how the tree addresses rows.
 */
export function composerDropMentionPath(
  transfer: ComposerDropTransfer,
  rootPath: string,
): string | null {
  if (composerDropCarriesFiles(transfer)) return null
  if (!transfer.types.includes('text/plain')) return null

  return droppedWorkspacePath(transfer.getData('text/plain'), rootPath)
}

/**
 * Deliberately strict: only a path that is really inside the open workspace, on
 * one line, becomes a mention. A dragged sentence that happens to look
 * path-shaped stays text, which is what the editor would have done with it.
 */
function droppedWorkspacePath(value: string, rootPath: string): string | null {
  const candidate = value.trim()
  if (candidate.length === 0) return null
  if (candidate.includes('\n')) return null

  const prefix = rootPath.endsWith('/') ? rootPath : `${rootPath}/`
  if (!candidate.startsWith(prefix)) return null

  const relative = candidate.slice(prefix.length).replace(/\/+$/, '')

  return relative.length === 0 ? null : relative
}
