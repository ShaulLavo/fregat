import type { DocumentRef, FilesystemPath } from '@/lib/documents/utils/types'

const COMMIT_MESSAGE_FILE = 'COMMIT_EDITMSG'

/** The path when `document` is git's commit message file, wherever the git directory sits. */
export function commitMessageFilePath(document: DocumentRef | null): FilesystemPath | null {
  if (document?.kind !== 'file') return null

  const { path } = document.resource
  const name = path.slice(path.lastIndexOf('/') + 1)
  return name === COMMIT_MESSAGE_FILE ? path : null
}
