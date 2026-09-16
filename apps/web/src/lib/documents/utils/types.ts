import type {
  GitFileStatus,
  SessionId,
  SettingsViewTarget,
  SettingsWriteTarget,
} from '@workspace/contracts'

declare const identityBrand: unique symbol
export type FilesystemPath = string & {
  readonly [identityBrand]: 'FilesystemPath'
}
export type WorkspaceRoot = FilesystemPath
export type DocumentKey = string & { readonly [identityBrand]: 'DocumentKey' }
export type TabId = string & { readonly [identityBrand]: 'TabId' }
export type ConflictId = string & { readonly [identityBrand]: 'ConflictId' }

export type FileResource = { readonly path: FilesystemPath }
type GitFileReference = { readonly path: FilesystemPath; readonly ref: string }
export type GitChangeStatus = GitFileStatus['index']
type GitChangeSource = 'staged' | 'worktree' | 'historical'
type ComparisonRevision = {
  readonly oldObjectId?: string
  readonly newObjectId?: string
  readonly oldPath?: FilesystemPath
  readonly status?: GitChangeStatus
}
type CheckpointRange = ComparisonRevision & {
  readonly owner: WorkspaceRoot
  readonly sessionId: SessionId
  readonly fromTurnCount: number
  readonly toTurnCount: number
}
export type GitComparison =
  | (ComparisonRevision & {
      readonly kind: 'snapshot'
      readonly path: FilesystemPath
      readonly source?: GitChangeSource
    })
  | (CheckpointRange & {
      readonly kind: 'checkpoint-file'
      readonly file: FileResource
    })
  | (CheckpointRange & { readonly kind: 'checkpoint-session' })
  | (CheckpointRange & { readonly kind: 'checkpoint-turn' })

export type FileDocumentRef = {
  readonly kind: 'file'
  readonly resource: FileResource
}
export type SettingsDocumentRef = {
  readonly kind: 'settings-json'
  readonly target: SettingsViewTarget
}
export type UnsyncedDocumentRef =
  | { readonly kind: 'git-ref'; readonly source: GitFileReference }
  | { readonly kind: 'git-diff'; readonly source: GitComparison }
  | { readonly kind: 'compare-saved'; readonly file: FileResource }
  /** `path` is where the resolution lands: it names the tab and picks the language. */
  | {
      readonly kind: 'conflict'
      readonly conflictId: ConflictId
      readonly path: FilesystemPath
    }
  | { readonly kind: 'search'; readonly root: WorkspaceRoot }
export type DocumentRef = FileDocumentRef | SettingsDocumentRef | UnsyncedDocumentRef
export type StandaloneDocumentRef = Exclude<DocumentRef, SettingsDocumentRef>
export type TabContent =
  | { readonly kind: 'document'; readonly document: StandaloneDocumentRef }
  | { readonly kind: 'settings' }
export type EditorTabRecord = {
  readonly id: TabId
  readonly content: TabContent
}
export type SettingsSelection =
  | { readonly kind: 'form' }
  | { readonly kind: 'json'; readonly target: SettingsViewTarget }
export type SaveCapability =
  | { readonly kind: 'none' }
  | { readonly kind: 'file'; readonly resource: FileResource }
  | { readonly kind: 'settings'; readonly target: SettingsWriteTarget }
export type BackingResource =
  | { readonly kind: 'file'; readonly resource: FileResource }
  | { readonly kind: 'settings'; readonly target: SettingsViewTarget }
  | { readonly kind: 'git-ref'; readonly source: GitFileReference }
  | { readonly kind: 'git-diff'; readonly source: GitComparison }
  | { readonly kind: 'conflict'; readonly conflictId: ConflictId }
  | { readonly kind: 'search'; readonly root: WorkspaceRoot }
export type ReopenScrollPosition = {
  readonly content: TabContent
  readonly position: { readonly left: number; readonly top: number }
}
