import { createContext } from 'react'

import type { TreeEntry } from '@/lib/file-system-types'
import type { DirectoryLoadOptions } from '@/lib/tree-model'

export type TreeToolbarActions = {
  readonly createFile: () => void
  readonly createFolder: () => void
  readonly mutationsEnabled: boolean
  readonly revealActiveFile: () => void
}

export type FileTreeActions = {
  readonly loadDirectory: (
    entry: TreeEntry,
    treePath: string,
    options?: DirectoryLoadOptions,
  ) => void
  readonly prefetchDirectory: (entry: TreeEntry, treePath: string) => void
  readonly publishToolbar: (actions: TreeToolbarActions | null) => void
  readonly publishVisibleItemCount: (count: number) => void
}

export const FileTreeActionsContext = createContext<FileTreeActions | null>(null)
