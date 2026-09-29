import type * as lsp from 'vscode-languageserver-protocol'
import type {
  LspDocument,
  LspDocumentOpenSnapshotOptions,
  LspDocumentOpenSnapshotResult,
  LspDocumentTransitionOptions,
  LspDocumentTransitionNotification,
  LspDocumentTransitionResult,
  LspLineStarts,
  LspTextDocumentSnapshot,
  LspTextSnapshot,
  LspWorkspaceDocumentAttachment,
  LspWorkspaceSnapshotEditOptions,
  LspWorkspaceSyncTarget,
  LspWorkspaceUnchangedSourceOptions,
} from './types'
import { registerDefaultLspWorkspaceFactory } from './workspaceFactory'

type MutableLspDocument = {
  languageId: string
  lineStarts: LspLineStarts
  sourceLogicalRevisionCount: number
  sourceRevision: number
  sourceSegment: object
  textSnapshot: LspTextSnapshot
  uri: lsp.DocumentUri
  version: number
}

type WorkspaceDocumentAttachmentRecord = {
  readonly document: MutableLspDocument
  readonly onDocumentTransition?: (transition: LspDocumentTransitionNotification) => void
}

export class LspWorkspace {
  private readonly attachments = new Map<
    LspWorkspaceDocumentAttachment,
    WorkspaceDocumentAttachmentRecord
  >()
  private readonly documentsByUri = new Map<lsp.DocumentUri, MutableLspDocument>()
  private readonly versionsByUri = new Map<lsp.DocumentUri, number>()
  private client: LspWorkspaceSyncTarget | null = null

  public get documents(): readonly LspDocument[] {
    return Array.from(this.documentsByUri.values()).map(cloneDocument)
  }

  public attachClient(client: LspWorkspaceSyncTarget): void {
    this.client = client
  }

  public openDocumentSnapshot(
    options: LspDocumentOpenSnapshotOptions,
  ): LspDocumentOpenSnapshotResult {
    assertSourceRevision(options.sourceRevision)
    const open = this.documentsByUri.get(options.uri)
    if (open) return this.attachOpenDocument(open, options)

    const document: MutableLspDocument = {
      languageId: options.languageId,
      lineStarts: options.lineStarts,
      sourceLogicalRevisionCount: 0,
      sourceRevision: options.sourceRevision,
      sourceSegment: options.sourceSegment,
      textSnapshot: options.textSnapshot,
      uri: options.uri,
      version: this.advanceVersion(options.uri, 1),
    }
    this.documentsByUri.set(options.uri, document)
    const result = this.attachDocument(document, options.onDocumentTransition)
    this.client?.didOpenDocument(cloneDocument(document))
    return result
  }

  public updateDocumentSnapshot(
    uri: lsp.DocumentUri,
    options: LspWorkspaceSnapshotEditOptions,
  ): LspDocument {
    const document = this.requireDocument(uri)
    assertLogicalRevisionCount(options.logicalRevisionCount)
    assertSourceRevision(options.sourceRevision)
    if (sameSourceTuple(document, options)) return adoptDuplicateSource(document, options)
    if (options.logicalRevisionCount === 0) {
      throw new Error('A new LSP document source requires a positive logical revision count.')
    }
    assertForwardSourcePoint(document, options)

    const nextVersion = this.advanceVersion(uri, options.logicalRevisionCount)
    const previousSnapshot = documentSnapshot(document)
    document.textSnapshot = options.textSnapshot
    document.lineStarts = options.lineStarts
    document.sourceLogicalRevisionCount = options.logicalRevisionCount
    document.sourceRevision = options.sourceRevision
    document.sourceSegment = options.sourceSegment
    document.version = nextVersion
    this.client?.didChangeDocument(cloneDocument(document), {
      edits: options.edits ?? [],
      previousSnapshot,
    })
    return cloneDocument(document)
  }

  public adoptUnchangedDocumentSource(
    uri: lsp.DocumentUri,
    options: LspWorkspaceUnchangedSourceOptions,
  ): LspDocument {
    const document = this.requireDocument(uri)
    assertSourceRevision(options.sourceRevision)
    if (options.textSnapshot !== document.textSnapshot) {
      throw new Error('An unchanged LSP source must retain the exact workspace text snapshot.')
    }
    if (sameSourceTuple(document, options)) return cloneDocument(document)
    assertForwardSourcePoint(document, options)

    document.sourceRevision = options.sourceRevision
    document.sourceSegment = options.sourceSegment
    document.sourceLogicalRevisionCount = 0
    return cloneDocument(document)
  }

  public transitionDocumentUri(
    attachment: LspWorkspaceDocumentAttachment,
    options: LspDocumentTransitionOptions,
  ): LspDocumentTransitionResult {
    const record = this.requireAttachment(attachment)
    const document = record.document
    if (document.uri === options.uri) return this.adoptCompletedTransition(document, options)

    assertSourceRevision(options.sourceRevision)
    assertSourceTextVersion(options.sourceTextVersion)
    assertTransitionTargetAvailable(this.documentsByUri.get(options.uri), document, options.uri)
    assertTransitionSourcePoint(document, options)
    if (document.sourceSegment === options.sourceSegment) {
      throw new Error('An LSP document URI transition requires a rotated source segment.')
    }

    const nextVersion = this.advanceVersion(options.uri, 1)
    const previousDocument = cloneDocument(document)
    this.client?.didCloseDocument(previousDocument)
    this.documentsByUri.delete(document.uri)
    document.uri = options.uri
    document.languageId = options.languageId
    document.textSnapshot = options.textSnapshot
    document.lineStarts = options.lineStarts
    document.sourceLogicalRevisionCount = 0
    document.sourceRevision = options.sourceRevision
    document.sourceSegment = options.sourceSegment
    document.version = nextVersion
    this.documentsByUri.set(options.uri, document)

    const nextDocument = cloneDocument(document)
    this.client?.didOpenDocument(nextDocument)
    this.notifyTransitionedAttachments(document, options.sourceTextVersion)
    return { document: nextDocument, previousDocument }
  }

  public closeDocument(attachment: LspWorkspaceDocumentAttachment): void {
    const record = this.attachments.get(attachment)
    if (!record) return

    this.attachments.delete(attachment)
    if (this.hasAttachment(record.document)) return

    this.documentsByUri.delete(record.document.uri)
    this.client?.didCloseDocument(cloneDocument(record.document))
  }

  public saveDocument(uri: lsp.DocumentUri): void {
    const document = this.documentsByUri.get(uri)
    if (!document) return
    this.client?.didSaveDocument(cloneDocument(document))
  }

  public getDocument(uri: lsp.DocumentUri): LspDocument | null {
    const document = this.documentsByUri.get(uri)
    return document ? cloneDocument(document) : null
  }

  public connected(): void {
    for (const document of this.documentsByUri.values()) {
      this.client?.didOpenDocument(cloneDocument(document))
    }
  }

  public disconnected(): void {
    return
  }

  private attachOpenDocument(
    document: MutableLspDocument,
    options: LspDocumentOpenSnapshotOptions,
  ): LspDocumentOpenSnapshotResult {
    if (document.languageId !== options.languageId) {
      throw new Error(
        `LSP document open as ${document.languageId}, reopened as ${options.languageId}: ${options.uri}`,
      )
    }
    if (!sameSourceTuple(document, options) || document.textSnapshot !== options.textSnapshot) {
      throw new Error('A second LSP document attachment must adopt the exact shared source point.')
    }
    return this.attachDocument(document, options.onDocumentTransition)
  }

  private attachDocument(
    document: MutableLspDocument,
    onDocumentTransition: ((transition: LspDocumentTransitionNotification) => void) | undefined,
  ): LspDocumentOpenSnapshotResult {
    const attachment = Object.freeze({}) as LspWorkspaceDocumentAttachment
    this.attachments.set(attachment, { document, onDocumentTransition })
    return { attachment, document: cloneDocument(document) }
  }

  private adoptCompletedTransition(
    document: MutableLspDocument,
    options: LspDocumentTransitionOptions,
  ): LspDocumentTransitionResult {
    if (document.languageId !== options.languageId) {
      throw new Error('An adopted LSP URI transition must retain the shared language identifier.')
    }
    if (document.textSnapshot !== options.textSnapshot || !sameSourceTuple(document, options)) {
      throw new Error('An adopted LSP URI transition must retain the exact shared source point.')
    }

    const current = cloneDocument(document)
    return { document: current, previousDocument: current }
  }

  private notifyTransitionedAttachments(
    document: MutableLspDocument,
    sourceTextVersion: number,
  ): void {
    for (const record of this.attachments.values()) {
      if (record.document !== document) continue
      record.onDocumentTransition?.({
        document: cloneDocument(document),
        sourceRevision: document.sourceRevision,
        sourceSegment: document.sourceSegment,
        sourceTextVersion,
      })
    }
  }

  private hasAttachment(document: MutableLspDocument): boolean {
    for (const record of this.attachments.values()) {
      if (record.document === document) return true
    }
    return false
  }

  private advanceVersion(uri: lsp.DocumentUri, count: number): number {
    const version = (this.versionsByUri.get(uri) ?? -1) + count
    if (!Number.isSafeInteger(version) || version < 0) {
      throw new RangeError(`LSP document version exceeds the safe integer range: ${uri}`)
    }
    this.versionsByUri.set(uri, version)
    return version
  }

  private requireDocument(uri: lsp.DocumentUri): MutableLspDocument {
    const document = this.documentsByUri.get(uri)
    if (document) return document
    throw new Error(`LSP document is not open: ${uri}`)
  }

  private requireAttachment(
    attachment: LspWorkspaceDocumentAttachment,
  ): WorkspaceDocumentAttachmentRecord {
    const record = this.attachments.get(attachment)
    if (record) return record
    throw new Error('LSP workspace document attachment is closed or belongs to another workspace.')
  }
}

function cloneDocument(document: MutableLspDocument): LspDocument {
  return {
    uri: document.uri,
    languageId: document.languageId,
    version: document.version,
    textSnapshot: document.textSnapshot,
    lineStarts: document.lineStarts,
  }
}

function documentSnapshot(document: MutableLspDocument): LspTextDocumentSnapshot {
  return {
    textSnapshot: document.textSnapshot,
    lineStarts: document.lineStarts,
  }
}

function sameSourceTuple(
  document: MutableLspDocument,
  source: { readonly sourceRevision: number; readonly sourceSegment: object },
): boolean {
  return (
    document.sourceRevision === source.sourceRevision &&
    document.sourceSegment === source.sourceSegment
  )
}

function adoptDuplicateSource(
  document: MutableLspDocument,
  options: LspWorkspaceSnapshotEditOptions,
): LspDocument {
  if (document.textSnapshot !== options.textSnapshot) {
    throw new Error('A duplicate LSP source tuple must retain the exact text snapshot.')
  }
  if (
    options.logicalRevisionCount !== 0 &&
    options.logicalRevisionCount !== document.sourceLogicalRevisionCount
  ) {
    throw new Error('A duplicate LSP source tuple must retain its logical revision count.')
  }
  return cloneDocument(document)
}

function assertForwardSourcePoint(
  document: MutableLspDocument,
  source: { readonly sourceRevision: number; readonly sourceSegment: object },
): void {
  if (document.sourceSegment !== source.sourceSegment) return
  if (source.sourceRevision > document.sourceRevision) return
  throw new Error('An LSP source revision must advance within one source segment.')
}

function assertLogicalRevisionCount(count: number): void {
  if (Number.isSafeInteger(count) && count >= 0) return
  throw new RangeError('logicalRevisionCount must be a safe non-negative integer.')
}

function assertSourceRevision(revision: number): void {
  if (Number.isSafeInteger(revision) && revision >= 0) return
  throw new RangeError('sourceRevision must be a safe non-negative integer.')
}

function assertSourceTextVersion(version: number): void {
  if (Number.isSafeInteger(version) && version >= 0) return
  throw new RangeError('sourceTextVersion must be a safe non-negative integer.')
}

function assertTransitionTargetAvailable(
  target: MutableLspDocument | undefined,
  source: MutableLspDocument,
  uri: lsp.DocumentUri,
): void {
  if (!target || target === source) return
  throw new Error(`LSP document URI transition target is already open: ${uri}`)
}

function assertTransitionSourcePoint(
  document: MutableLspDocument,
  options: LspDocumentTransitionOptions,
): void {
  if (document.textSnapshot !== options.textSnapshot) {
    throw new Error('An LSP document URI transition must retain the exact synchronized snapshot.')
  }
  if (document.sourceRevision === options.sourceRevision) return
  throw new Error('An LSP document URI transition must retain the synchronized source revision.')
}

export function arrayLspLineStarts(lineStarts: readonly number[]): LspLineStarts {
  return {
    length: lineStarts.length,
    at: (index) => lineStarts[index],
    indexForOffset: (offset) => arrayRowForOffset(lineStarts, offset),
    toArray: () => lineStarts,
  }
}

function arrayRowForOffset(lineStarts: readonly number[], offset: number): number {
  let low = 0
  let high = lineStarts.length - 1
  let row = 0
  while (low <= high) {
    const middle = (low + high) >> 1
    if ((lineStarts[middle] ?? 0) <= offset) {
      row = middle
      low = middle + 1
      continue
    }
    high = middle - 1
  }
  return row
}

registerDefaultLspWorkspaceFactory(() => new LspWorkspace())
