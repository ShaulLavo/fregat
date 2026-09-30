import type * as lsp from 'vscode-languageserver-protocol'
import type { LspRequestId } from './protocol'

export type LspTransportHandler = (message: string) => void

export type LspTransport = {
  send(message: string): void
  subscribe(handler: LspTransportHandler): void
  unsubscribe(handler: LspTransportHandler): void
}

export type LspTextEdit = {
  readonly from: number
  readonly to: number
  readonly text: string
}

// Read access only. The whole text is read once per payload the protocol defines as whole text
// (didOpen, full sync, didSave with text), from the captured source, never kept.
export type LspTextSnapshot = {
  readonly length: number
  readRange(start: number, end: number): string
  forEachTextChunk(visit: (text: string, start: number, end: number) => void): void
}

// Read-only line-start access; backed by an array adapter or the editor's
// suffix-delta view so large documents never materialize per keystroke.
export type LspLineStarts = {
  readonly length: number
  at(index: number): number | undefined
  indexForOffset(offset: number): number
  toArray(): readonly number[]
}

export type LspTextDocumentSnapshot = {
  readonly textSnapshot: LspTextSnapshot
  readonly lineStarts: LspLineStarts
}

export type LspDocumentSyncMode = 'none' | 'full' | 'incremental'

export type LspDocumentSaveSync = {
  readonly enabled: boolean
  readonly includeText: boolean
}

export type LspDocumentSyncOptions = {
  readonly change: LspDocumentSyncMode
  readonly openClose: boolean
  readonly save: LspDocumentSaveSync
}

export type LspDocumentOpenSnapshotOptions = LspTextDocumentSnapshot & {
  readonly uri: lsp.DocumentUri
  readonly languageId: string
  readonly sourceRevision: number
  readonly sourceSegment: object
  readonly onDocumentTransition?: (transition: LspDocumentTransitionNotification) => void
}

export type LspDocument = {
  readonly uri: lsp.DocumentUri
  readonly languageId: string
  readonly version: number
  readonly textSnapshot: LspTextSnapshot
  readonly lineStarts: LspLineStarts
}

declare const lspWorkspaceDocumentAttachmentBrand: unique symbol

export type LspWorkspaceDocumentAttachment = {
  readonly [lspWorkspaceDocumentAttachmentBrand]: true
}

export type LspDocumentOpenSnapshotResult = {
  readonly attachment: LspWorkspaceDocumentAttachment
  readonly document: LspDocument
}

export type LspWorkspaceSnapshotEditOptions = LspTextDocumentSnapshot & {
  readonly edits: readonly LspTextEdit[] | null
  readonly logicalRevisionCount: number
  readonly sourceRevision: number
  readonly sourceSegment: object
}

export type LspWorkspaceUnchangedSourceOptions = LspTextDocumentSnapshot & {
  readonly sourceRevision: number
  readonly sourceSegment: object
}

export type LspDocumentTransitionOptions = Omit<
  LspDocumentOpenSnapshotOptions,
  'onDocumentTransition'
> & {
  readonly sourceTextVersion: number
}

export type LspDocumentTransitionResult = {
  readonly document: LspDocument
  readonly previousDocument: LspDocument
}

export type LspDocumentTransitionNotification = {
  readonly document: LspDocument
  readonly sourceRevision: number
  readonly sourceSegment: object
  readonly sourceTextVersion: number
}

export type LspDocumentChange = {
  readonly edits: readonly LspTextEdit[]
  readonly previousSnapshot: LspTextDocumentSnapshot
}

export type LspWorkspaceSyncTarget = {
  didOpenDocument(document: LspDocument): void
  didChangeDocument(document: LspDocument, change: LspDocumentChange): void
  didSaveDocument(document: LspDocument): void
  didCloseDocument(document: LspDocument): void
}

export type LspClientWorkspace = {
  readonly documents: readonly LspDocument[]
  attachClient(client: LspWorkspaceSyncTarget): void
  openDocumentSnapshot(options: LspDocumentOpenSnapshotOptions): LspDocumentOpenSnapshotResult
  updateDocumentSnapshot(
    uri: lsp.DocumentUri,
    options: LspWorkspaceSnapshotEditOptions,
  ): LspDocument
  adoptUnchangedDocumentSource(
    uri: lsp.DocumentUri,
    options: LspWorkspaceUnchangedSourceOptions,
  ): LspDocument
  transitionDocumentUri(
    attachment: LspWorkspaceDocumentAttachment,
    options: LspDocumentTransitionOptions,
  ): LspDocumentTransitionResult
  closeDocument(attachment: LspWorkspaceDocumentAttachment): void
  saveDocument(uri: lsp.DocumentUri): void
  getDocument(uri: lsp.DocumentUri): LspDocument | null
  connected(): void
  disconnected(): void
}

export type LspWorkspaceFactory = () => LspClientWorkspace

export type LspRequestHandle<TResult = unknown> = {
  readonly id: LspRequestId
  readonly response: Promise<TResult>
  cancel(): void
}

export type PublishDiagnosticsNotificationParams = {
  readonly uri: lsp.DocumentUri
  readonly version?: number
  readonly diagnostics: readonly lsp.Diagnostic[]
}

export type LspNotificationHandler<TClient = unknown> = (
  client: TClient,
  params: unknown,
  message: lsp.NotificationMessage,
) => boolean | void

export type LspServerRequestHandler<TClient = unknown> = (
  client: TClient,
  params: unknown,
  message: lsp.RequestMessage,
) => unknown | Promise<unknown>

export type LspUnhandledNotificationHandler<TClient = unknown> = (
  client: TClient,
  method: string,
  params: unknown,
  message: lsp.NotificationMessage,
) => void

export type LspServerMessageNotification = {
  readonly method: 'window/logMessage' | 'window/showMessage'
  readonly type: number
  readonly message: string | null
  readonly params: unknown
}

export type LspServerMessageHandler<TClient = unknown> = (
  client: TClient,
  notification: LspServerMessageNotification,
) => void
