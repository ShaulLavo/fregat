import type { GitFileStatus } from '@workspace/contracts'

export type PanelSection = 'staged' | 'worktree'

export type BlobDiffRequest = {
  path: string
  oldPath?: string
  oldObjectId?: string
  newObjectId?: string
}

export type ChangeRow = {
  file: GitFileStatus
  section: PanelSection
  status: GitFileStatus['index'] | GitFileStatus['worktree']
}

export type DiscardRequest = {
  readonly section: PanelSection
  readonly paths: readonly string[]
  /** Untracked, or staged as new: discarding deletes these outright. */
  readonly newFiles: number
}
