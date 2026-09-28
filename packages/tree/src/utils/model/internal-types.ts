// Modified for Platform from Pierre. Apache-2.0; see LICENSE-pierre and UPSTREAM.md.
import type { PathStoreEvent } from '../path-store/public-types'

import type {
  FileTreeScrollBehavior,
  FileTreeScrollOffset,
  FileTreeVisibleRow,
} from './public-types'

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

export type StorePathMutationEvent = Extract<
  PathStoreEvent,
  { operation: 'add' | 'remove' | 'move' | 'batch' }
>
