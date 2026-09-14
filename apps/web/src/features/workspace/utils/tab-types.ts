import type { StatusPresentation } from '@/features/git/utils/types'
import type { FilesystemPath, TabContent, TabId } from '@/lib/documents/utils/types'
import type { ResolvedFileIcon } from '@/lib/file-icons'

export type EditorTabConflictMap = Readonly<Record<string, { remotePath: FilesystemPath }>>

/** The working-tree file a diff tab is comparing, when it compares exactly one. */
export type EditorTabDiffSource = {
  /** A deleted file has nothing left on disk to open. */
  onDisk: boolean
  path: FilesystemPath
}

export type EditorTabModel = {
  active: boolean
  copyPath: string
  copyRelativePath: string
  diffSource: EditorTabDiffSource | null
  diffStatus: StatusPresentation | null
  diffSuffix: string
  icon: ResolvedFileIcon
  /** The conflict editor, or a file git reports as conflicted: the title shows conflict navigation. */
  mergeConflicts: boolean
  id: TabId
  name: string
  content: TabContent
  title: string
}
