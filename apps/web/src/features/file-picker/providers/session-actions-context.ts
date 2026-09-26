import { createContext } from 'react'

import type { FsEntry } from '@/lib/file-system-types'

export type FilePickerSessionActions = {
  readonly jumpTo: (path: string) => void
  readonly navigateTo: (path: string) => void
  readonly resizeColumn: (depth: number, width: number) => void
  readonly revealEntry: (entry: FsEntry) => void
  readonly selectEntry: (entry: FsEntry) => void
}

export const FilePickerSessionActionsContext = createContext<FilePickerSessionActions | null>(null)
