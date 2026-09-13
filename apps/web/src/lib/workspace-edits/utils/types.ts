import type { DocumentTextSnapshot, TextEdit } from '@singapore-editor/core/document'
import type { ApplyWorkspaceEditResult } from '@singapore-editor/lsp-plugin'
import type { FilesystemPath } from '@/lib/documents/utils/types'

declare const textChangeSourceBrand: unique symbol

export interface TextChangeSource {
  readonly [textChangeSourceBrand]: true
  readonly path: FilesystemPath
  readonly textSnapshot: DocumentTextSnapshot
}

export interface TextChangePreparation {
  readText(path: FilesystemPath): Promise<TextChangeSource>
}

export interface TextChangeTarget {
  readonly source: TextChangeSource
  readonly edits: readonly TextEdit[]
}

export interface TextChangeRequest {
  readonly source: 'search-replace'
  readonly signal: AbortSignal
  readonly prepare: (operation: TextChangePreparation) => Promise<{
    readonly label: string
    readonly requireConfirmation: boolean
    readonly targets: readonly TextChangeTarget[]
  }>
}

export interface WorkspaceTextChanges {
  readonly applyTextChange: (request: TextChangeRequest) => Promise<ApplyWorkspaceEditResult>
}
