import { filesystemResource } from '@/lib/documents/utils/capabilities'
import type { FilesystemPath, TabContent, TabId, WorkspaceRoot } from '@/lib/documents/utils/types'
import type { FileOpenIntent } from '@/lib/file-open-intent/state/service'

export type EditorTabPrefetchCandidate = {
  active?: boolean
  id: TabId
  content: TabContent
}

export type EditorTabPrefetchTarget = {
  id: TabId
  path: FilesystemPath
}

export function editorTabPrefetchTarget(
  tab: EditorTabPrefetchCandidate,
): EditorTabPrefetchTarget | null {
  if (tab.active) return null

  const resource = tab.content.kind === 'document' ? filesystemResource(tab.content.document) : null
  if (!resource) return null

  return { id: tab.id, path: resource.path }
}

export function editorTabPrefetchRegistrationKey(target: EditorTabPrefetchTarget) {
  return `${target.id}:${target.path}`
}

export function editorTabFileOpenIntent(
  rootPath: WorkspaceRoot,
  target: EditorTabPrefetchTarget,
): FileOpenIntent {
  return {
    path: target.path,
    rootPath,
    source: 'tab',
    tabId: target.id,
  }
}
