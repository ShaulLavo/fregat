export type WorkspaceResourceType = 'directory' | 'file'

export type WorkspaceResourcePrecondition =
  | { readonly kind: 'missing' }
  | {
      /** Exists as `type`; the server guards it on identity rather than content. */
      readonly kind: 'present'
      readonly type: WorkspaceResourceType
    }
  | {
      readonly kind: 'snapshot'
      readonly mtimeMs: number
      readonly version: string
    }
  | {
      readonly afterOperation: number
      readonly kind: 'transaction'
    }

export type WorkspacePersistenceOperation =
  | {
      readonly expected: Exclude<WorkspaceResourcePrecondition, { kind: 'missing' | 'present' }>
      readonly index: number
      readonly kind: 'write'
      readonly path: string
      readonly text: string
    }
  | {
      readonly destination: WorkspaceResourcePrecondition
      readonly folder?: boolean
      readonly ignoreIfExists: boolean
      readonly index: number
      readonly kind: 'create'
      readonly overwrite: boolean
      readonly path: string
    }
  | {
      readonly destination: Extract<WorkspaceResourcePrecondition, { kind: 'missing' }>
      readonly index: number
      readonly kind: 'copy'
      readonly newPath: string
      readonly oldPath: string
      readonly source: Exclude<WorkspaceResourcePrecondition, { kind: 'missing' }>
    }
  | {
      readonly destination: WorkspaceResourcePrecondition
      readonly ignoreIfExists: boolean
      readonly index: number
      readonly kind: 'rename'
      readonly newPath: string
      readonly oldPath: string
      readonly overwrite: boolean
      readonly source: Exclude<WorkspaceResourcePrecondition, { kind: 'missing' }>
    }
  | {
      readonly expected: WorkspaceResourcePrecondition
      readonly ignoreIfNotExists: boolean
      readonly index: number
      readonly kind: 'delete'
      readonly path: string
      readonly recursive: boolean
    }

export type WorkspaceEditState =
  | 'preparing'
  | 'prepared'
  | 'committed'
  | 'finalized'
  | 'aborted'
  | 'rolled-back'
  | 'undo-committed'
  | 'undone'
  | 'redo-committed'
  | 'redone'
  | 'partial'
  | 'released'

export type WorkspaceEditRecoveryTarget = 'rolled-back' | 'finalized' | 'undone' | 'redone'

/**
 * The writer id on a file operation's events: one per transition, so the window that ran it can
 * claim exactly its own events, including a late one from its own earlier undo.
 */
export function fileOperationWriteId(operationId: string, generation: number) {
  return `${operationId}#${generation}`
}

/** A transition has moved files but not yet finalized: a crash or a failure rolls it back. */
export function isProvisionalWorkspaceEditState(state: WorkspaceEditState) {
  return state === 'committed' || state === 'undo-committed' || state === 'redo-committed'
}

export type WorkspaceEditEventPublication = 'pending' | 'published' | 'suppressed'

export type WorkspaceEditResultEntry =
  | {
      readonly exists: false
      readonly path: string
    }
  | {
      readonly exists: true
      readonly mtimeMs: number
      readonly path: string
      readonly size: number
      readonly type: 'file'
      readonly version: string
    }
  | {
      readonly exists: true
      readonly mtimeMs: number
      readonly path: string
      readonly type: 'directory'
    }

/** Which undo history a journaled operation belongs to. Each category is its own stack. */
export type WorkspaceEditCategory = 'file-operation' | 'workspace-edit'

export type WorkspaceEditPrepareRequest = {
  readonly bodyDigest: string
  readonly category: WorkspaceEditCategory
  /** What the history names this operation, such as "Move 3 items into src". */
  readonly label: string
  readonly operationId: string
  readonly operations: readonly WorkspacePersistenceOperation[]
  readonly origin: 'workspace-edit'
  readonly workspace: string
}

export type WorkspaceEditTransitionRequest = {
  readonly expectedGeneration: number
  readonly operationId: string
  readonly transitionId: string
}

export type WorkspaceEditRecoverRequest = WorkspaceEditTransitionRequest & {
  readonly recoveryTarget: WorkspaceEditRecoveryTarget
}

export type WorkspaceEditPartialAcknowledgement = {
  readonly generation: number
  readonly unrecoveredPaths: readonly string[]
}

export type WorkspaceEditReleaseRequest = WorkspaceEditTransitionRequest & {
  readonly acknowledgePartial?: WorkspaceEditPartialAcknowledgement
}

export type WorkspaceEditResult = {
  readonly affectedPaths: readonly string[]
  readonly entries: readonly WorkspaceEditResultEntry[]
  readonly eventPublication: WorkspaceEditEventPublication
  readonly generation: number
  readonly operationId: string
  readonly recoveryTarget?: WorkspaceEditRecoveryTarget
  readonly rolledBackPaths: readonly string[]
  readonly serverEpoch: string
  readonly state: WorkspaceEditState
  readonly unrecoveredPaths: readonly string[]
}

export type WorkspaceEditStatusResult =
  | {
      readonly found: false
      readonly operationId: string
      readonly serverEpoch: string
    }
  | {
      readonly found: true
      readonly result: WorkspaceEditResult
    }

export type WorkspaceEditRecoverySummary = {
  readonly generation: number
  readonly operationId: string
  readonly recoveryTarget: WorkspaceEditRecoveryTarget
  readonly unrecoveredPaths: readonly string[]
  readonly workspace: string
}

export type WorkspaceEditRecoveryListResult = {
  readonly operations: readonly WorkspaceEditRecoverySummary[]
  readonly serverEpoch: string
}

/** One resource change of a history entry, in workspace-relative paths. */
export type WorkspaceEditHistoryLeg =
  | { readonly kind: 'copy'; readonly newPath: string; readonly oldPath: string }
  | { readonly folder: boolean; readonly kind: 'create'; readonly path: string }
  | { readonly kind: 'delete'; readonly path: string }
  | { readonly kind: 'rename'; readonly newPath: string; readonly oldPath: string }
  | { readonly kind: 'write'; readonly path: string }

export type WorkspaceEditHistoryEntry = {
  readonly category: WorkspaceEditCategory
  readonly generation: number
  readonly label: string
  readonly legs: readonly WorkspaceEditHistoryLeg[]
  readonly operationId: string
  readonly state: WorkspaceEditState
}

/** Newest first: `undo[0]` is the only entry that can be undone, `redo[0]` the only redo. */
export type WorkspaceEditHistoryResult = {
  readonly redo: readonly WorkspaceEditHistoryEntry[]
  readonly serverEpoch: string
  readonly undo: readonly WorkspaceEditHistoryEntry[]
}
