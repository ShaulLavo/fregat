import type {
  FileTreeScrollBehavior,
  FileTreeScrollOffset,
  FileTreeVisibleRow,
} from './publicTypes'

export type FileTreeControllerListener = () => void

export interface FileTreeStickyRowCandidate {
  row: FileTreeVisibleRow
  subtreeEndIndex: number
}

export interface FileTreeScrollRequest {
  behavior: FileTreeScrollBehavior
  id: number
  offset: FileTreeScrollOffset
  visibleIndex: number
}
