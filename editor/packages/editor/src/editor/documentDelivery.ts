import {
  pieceTableByteOrderMark,
  pieceTableContainsUnusualLineTerminators,
  pieceTableLineEnding,
} from '@singapore-editor/textbuffer'
import type { EditorTextBuffer, EditorTextBufferChange } from '../documentSession'
import type { DocumentTextSnapshot, TextReadSnapshot } from '../documentTextSnapshot'
import type {
  DocumentSyncPoint,
  DocumentSyncSegment,
  DocumentChangesSinceSyncPoint,
  DocumentLogicalRevisionScope,
} from './editChain'
import { createEditorRuntimeSessionId } from '../syntax/session'
import { createError } from '../logging/errors'
import { completeDocumentCleanup } from './documentCleanup'
import type {
  DocumentWorkerIdentity,
  DocumentWorkerPoint,
  DocumentWorkerReadReference,
  DocumentWorkerSourceCommand,
  DocumentWorkerSourceResult,
} from '../document/workerReader'

const revisionBrand = Symbol('document.revision')

export type DocumentRevision = {
  readonly point: DocumentSyncPoint
  readonly [revisionBrand]: true
}

export type DocumentRead = {
  readonly revision: DocumentRevision
  readonly text: TextReadSnapshot
}

export type DocumentSourceConnection = {
  readonly generation: number
  nextRegistration(): number
  send(
    command: DocumentWorkerSourceCommand,
    signal: AbortSignal,
  ): Promise<DocumentWorkerSourceResult>
  release(identity: DocumentWorkerIdentity): void
}

export type DocumentSourceEndpoint = {
  connect(): Promise<DocumentSourceConnection | null>
}

export type DocumentProjectionUpdate = {
  readonly identity: DocumentWorkerIdentity
  readonly base: DocumentWorkerPoint | null
  readonly baseRead: DocumentRead | null
  readonly target: DocumentWorkerPoint
  readonly read: DocumentRead
  readonly changes: DocumentChangesSinceSyncPoint | null
}
export type DocumentProjectionReceipt = {
  readonly kind: 'delivered' | 'applied'
  readonly identity: DocumentWorkerIdentity
  readonly base: DocumentWorkerPoint | null
  readonly target: DocumentWorkerPoint
}
export type DocumentProjectionConnection = {
  readonly generation: number
  nextRegistration(): number
  admit(update: DocumentProjectionUpdate, signal: AbortSignal): Promise<DocumentProjectionReceipt>
  release(identity: DocumentWorkerIdentity): void
}
export type DocumentProjectionEndpoint = {
  readonly logicalRevisionScope?: DocumentLogicalRevisionScope
  connect(): Promise<DocumentProjectionConnection | null>
}
type SourceEndpoint = DocumentSourceEndpoint | DocumentProjectionEndpoint

export type DocumentContributionSource = Pick<DocumentDelivery, 'read' | 'changesBetween'> & {
  prepareReader(
    endpoint: DocumentSourceEndpoint,
    read: DocumentRead,
    signal?: AbortSignal,
  ): Promise<PreparedDocumentWorkerRead | null>
  prepareProjection(
    endpoint: DocumentProjectionEndpoint,
    read: DocumentRead,
  ): Promise<DocumentProjectionReceipt | null>
}
export type DocumentContributionScope = {
  readonly source: DocumentContributionSource
  dispose(): void
}
type SourceScope = {
  readonly endpoints: Set<SourceEndpoint>
  readonly cancellation: AbortController
}

type ProgressState = {
  readonly identity: DocumentWorkerIdentity
  readonly cancellation: AbortController
  point: DocumentSyncPoint | null
  pending: Promise<void> | null
}
type ReaderProgress = ProgressState & {
  readonly kind: 'reader'
  readonly connection: DocumentSourceConnection
  registered: boolean
}
type ProjectionProgress = ProgressState & {
  readonly kind: 'projection'
  readonly connection: DocumentProjectionConnection
  readonly logicalRevisionScope: DocumentLogicalRevisionScope | null
  receipt: DocumentProjectionReceipt | null
  read: DocumentRead | null
}
type SourceProgress = ReaderProgress | ProjectionProgress

export type PreparedDocumentWorkerRead = {
  readonly reference: DocumentWorkerReadReference
  dispose(): Promise<void>
}

export class DocumentDelivery {
  private readonly incarnation = createEditorRuntimeSessionId()
  private readonly issued = new WeakMap<
    DocumentRevision,
    { readonly read: DocumentRead; readonly snapshot: DocumentTextSnapshot }
  >()
  private readonly segments = new WeakMap<DocumentSyncSegment, string>()
  private readonly endpoints = new Map<SourceEndpoint, SourceProgress>()
  private readonly sourceScopes = new Map<SourceEndpoint, Set<SourceScope>>()
  private nextSegment = 0
  private nextRead = 0
  private head: DocumentRead
  private disposed = false

  public constructor(
    readonly buffer: EditorTextBuffer,
    readonly documentId: string,
  ) {
    this.head = this.issue(buffer.getDocumentSyncPoint(), buffer.getTextSnapshot())
  }

  public accept(event: EditorTextBufferChange): DocumentRead | null {
    if (this.disposed) return null
    this.head = this.issue(event.syncPointAfter, event.change.textSnapshot)
    return this.head
  }

  public current(): DocumentRead | null {
    if (this.disposed) return null
    const point = this.buffer.getDocumentSyncPoint()
    if (point !== this.head.revision.point)
      this.head = this.issue(point, this.buffer.getTextSnapshot())
    return this.head
  }

  public read(revision: DocumentRevision): DocumentRead | null {
    if (this.disposed) return null
    return this.issued.get(revision)?.read ?? null
  }

  public snapshot(read: DocumentRead): DocumentTextSnapshot | null {
    if (this.disposed) return null
    const issued = this.issued.get(read.revision)
    return issued?.read === read ? issued.snapshot : null
  }

  public changesBetween(
    base: DocumentRevision,
    target: DocumentRevision,
    scope: DocumentLogicalRevisionScope | null = null,
  ) {
    if (!this.read(base) || !this.read(target)) return null
    return this.buffer.changesBetweenDocumentSyncPoints(base.point, target.point, scope)
  }

  public createScope(): DocumentContributionScope {
    const scope: SourceScope = { endpoints: new Set(), cancellation: new AbortController() }
    return {
      source: {
        read: (revision) => (scope.cancellation.signal.aborted ? null : this.read(revision)),
        changesBetween: (base, target, logicalScope) =>
          scope.cancellation.signal.aborted
            ? null
            : this.changesBetween(base, target, logicalScope),
        prepareReader: (endpoint, read, signal) =>
          this.prepareReader(endpoint, read, scope, signal),
        prepareProjection: (endpoint, read) => this.prepareProjection(endpoint, read, scope),
      },
      dispose: () => this.releaseScope(scope),
    }
  }

  private releaseScope(scope: SourceScope): void {
    if (scope.cancellation.signal.aborted) return
    scope.cancellation.abort()
    const endpoints = [...scope.endpoints]
    scope.endpoints.clear()
    completeDocumentCleanup(
      endpoints.map((endpoint) => () => this.releaseEndpoint(endpoint, scope)),
    )
  }

  private releaseEndpoint(endpoint: SourceEndpoint, scope: SourceScope): void {
    const scopes = this.sourceScopes.get(endpoint)
    scopes?.delete(scope)
    if (scopes?.size) return
    this.sourceScopes.delete(endpoint)
    const progress = this.endpoints.get(endpoint)
    this.endpoints.delete(endpoint)
    progress?.cancellation.abort()
    if (progress) progress.connection.release(progress.identity)
  }

  private async prepareReader(
    endpoint: DocumentSourceEndpoint,
    read: DocumentRead,
    scope: SourceScope,
    signal?: AbortSignal,
  ): Promise<PreparedDocumentWorkerRead | null> {
    const waitSignal = signal
      ? AbortSignal.any([scope.cancellation.signal, signal])
      : scope.cancellation.signal
    if (waitSignal.aborted || this.disposed) return null
    const scopes = this.sourceScopes.get(endpoint) ?? new Set<SourceScope>()
    scopes.add(scope)
    scope.endpoints.add(endpoint)
    this.sourceScopes.set(endpoint, scopes)
    const issued = this.read(read.revision)
    if (issued !== read) return null
    const connection = await scopeWait(endpoint.connect(), waitSignal)
    if (!connection || this.disposed || waitSignal.aborted) return null
    let progress = this.endpoints.get(endpoint)
    if (!progress || progress.kind !== 'reader' || progress.connection !== connection) {
      progress?.cancellation.abort()
      if (progress) progress.connection.release(progress.identity)
      progress = {
        kind: 'reader',
        connection,
        identity: {
          documentId: this.incarnation,
          documentGeneration: 1,
          endpointGeneration: connection.generation,
          registrationId: connection.nextRegistration(),
        },
        cancellation: new AbortController(),
        point: null,
        registered: false,
        pending: null,
      }
      this.endpoints.set(endpoint, progress)
    }
    while (progress.pending) await scopeWait(progress.pending, waitSignal)
    if (this.disposed || waitSignal.aborted || this.endpoints.get(endpoint) !== progress)
      return null
    let settle = () => {}
    progress.pending = new Promise<void>((resolve) => {
      settle = resolve
    })
    const admission = this.prepareSource(endpoint, progress, read).finally(() => {
      progress.pending = null
      settle()
    })
    return await scopeWait(admission, waitSignal, (prepared) => prepared?.dispose())
  }

  private async prepareProjection(
    endpoint: DocumentProjectionEndpoint,
    read: DocumentRead,
    scope: SourceScope,
  ): Promise<DocumentProjectionReceipt | null> {
    if (scope.cancellation.signal.aborted || this.read(read.revision) !== read) return null
    const scopes = this.sourceScopes.get(endpoint) ?? new Set<SourceScope>()
    scopes.add(scope)
    scope.endpoints.add(endpoint)
    this.sourceScopes.set(endpoint, scopes)
    const connection = await scopeWait(endpoint.connect(), scope.cancellation.signal)
    if (!connection || this.disposed || scope.cancellation.signal.aborted) return null
    let progress = this.endpoints.get(endpoint)
    if (!progress || progress.kind !== 'projection' || progress.connection !== connection) {
      progress?.cancellation.abort()
      if (progress) progress.connection.release(progress.identity)
      progress = {
        kind: 'projection',
        connection,
        logicalRevisionScope: endpoint.logicalRevisionScope ?? null,
        identity: {
          documentId: this.incarnation,
          documentGeneration: 1,
          endpointGeneration: connection.generation,
          registrationId: connection.nextRegistration(),
        },
        cancellation: new AbortController(),
        point: null,
        pending: null,
        receipt: null,
        read: null,
      }
      this.endpoints.set(endpoint, progress)
    }
    while (progress.pending) await scopeWait(progress.pending, scope.cancellation.signal)
    if (
      this.disposed ||
      scope.cancellation.signal.aborted ||
      this.endpoints.get(endpoint) !== progress
    )
      return null
    let settle = () => {}
    progress.pending = new Promise<void>((resolve) => {
      settle = resolve
    })
    const admitted = this.admitProjection(endpoint, progress, read).finally(() => {
      progress.pending = null
      settle()
    })
    return await scopeWait(admitted, scope.cancellation.signal)
  }

  private async admitProjection(
    endpoint: DocumentProjectionEndpoint,
    progress: ProjectionProgress,
    read: DocumentRead,
  ): Promise<DocumentProjectionReceipt> {
    const target = read.revision.point
    if (progress.receipt && pointsEqual(progress.receipt.target, this.wirePoint(target)))
      return progress.receipt
    if (progress.point && progress.point.revision > target.revision)
      throw new DOMException('Projected source demand was superseded', 'AbortError')
    const base = progress.point ? this.wirePoint(progress.point) : null
    const changes = progress.point
      ? this.buffer.changesBetweenDocumentSyncPoints(
          progress.point,
          target,
          progress.logicalRevisionScope,
        )
      : null
    const receipt = await progress.connection.admit(
      {
        identity: progress.identity,
        base,
        baseRead: progress.read,
        target: this.wirePoint(target),
        read,
        changes,
      },
      progress.cancellation.signal,
    )
    if (this.disposed || this.endpoints.get(endpoint) !== progress)
      throw new DOMException('Document source scope was released', 'AbortError')
    if (!projectionReceiptMatches(receipt, progress.identity, base, this.wirePoint(target)))
      throw createError({
        message: 'Projected source acknowledgement failed',
        code: 'DOCUMENT_PROJECTION_ACKNOWLEDGEMENT',
        status: 409,
        why: 'The acknowledgement names another source operation or scope.',
        fix: 'Inspect the contribution source protocol.',
        internal: {
          endpointGeneration: progress.identity.endpointGeneration,
          registrationId: progress.identity.registrationId,
          revision: target.revision,
        },
      })
    progress.point = target
    progress.read = read
    progress.receipt = receipt
    return receipt
  }

  private async prepareSource(
    endpoint: DocumentSourceEndpoint,
    progress: ReaderProgress,
    read: DocumentRead,
  ): Promise<PreparedDocumentWorkerRead | null> {
    if (!progress.registered) {
      const command: Extract<DocumentWorkerSourceCommand, { kind: 'register' }> = {
        kind: 'register',
        identity: progress.identity,
      }
      const result = await progress.connection.send(command, progress.cancellation.signal)
      if (this.disposed) return null
      if (result.kind !== 'registered') throw admissionFailure(command, result)
      progress.registered = true
    }
    if (read.revision.point !== this.buffer.getDocumentSyncPoint())
      return this.pinRead(endpoint, progress, read)
    if (progress.point === read.revision.point) return this.pinRead(endpoint, progress, read)
    const text = this.snapshot(read)
    if (!text) return null
    const target = read.revision.point
    const changed =
      progress.point && this.buffer.changesBetweenDocumentSyncPoints(progress.point, target, null)
    const base = progress.point ? this.wirePoint(progress.point) : null
    const command: DocumentWorkerSourceCommand =
      changed?.edits && base
        ? {
            kind: 'advance',
            identity: progress.identity,
            base,
            target: this.wirePoint(target),
            edits: changed.edits,
          }
        : resetSource(progress.identity, base, this.wirePoint(target), text)
    if (!(await this.applySource(endpoint, progress, command, target))) return null
    return this.pinRead(endpoint, progress, read)
  }

  private async pinRead(
    endpoint: DocumentSourceEndpoint,
    progress: ReaderProgress,
    read: DocumentRead,
  ): Promise<PreparedDocumentWorkerRead | null> {
    const point = read.revision.point
    const readId = `${this.documentId}:${++this.nextRead}`
    let command: DocumentWorkerSourceCommand = {
      kind: 'pin',
      identity: progress.identity,
      point: this.wirePoint(point),
      readId,
    }
    let result = await progress.connection.send(command, progress.cancellation.signal)
    if (result.kind === 'rejected' && result.reason === 'unavailable') {
      const snapshot = this.snapshot(read)
      if (!snapshot) return null
      const source = resetSource(progress.identity, null, this.wirePoint(point), snapshot)
      command = {
        kind: 'importRead',
        identity: progress.identity,
        point: this.wirePoint(point),
        readId,
        chunks: source.chunks,
        lineEnding: source.lineEnding,
        byteOrderMark: source.byteOrderMark,
        containsUnusualLineTerminators: source.containsUnusualLineTerminators,
      }
      result = await progress.connection.send(command, progress.cancellation.signal)
    }
    if (
      this.disposed ||
      this.endpoints.get(endpoint) !== progress ||
      progress.cancellation.signal.aborted
    )
      return null
    if (result.kind !== 'pinned') throw admissionFailure(command, result)
    let disposed = false
    return {
      reference: result.reference,
      dispose: async () => {
        if (disposed) return
        disposed = true
        if (progress.cancellation.signal.aborted) return
        await progress.connection.send(
          { kind: 'unpin', identity: progress.identity, readId },
          progress.cancellation.signal,
        )
      },
    }
  }

  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const progress = [...this.endpoints.values()]
    this.endpoints.clear()
    for (const scopes of this.sourceScopes.values()) {
      for (const scope of scopes) scope.cancellation.abort()
    }
    this.sourceScopes.clear()
    completeDocumentCleanup(
      progress.map((entry) => () => {
        entry.cancellation.abort()
        entry.connection.release(entry.identity)
      }),
    )
  }

  private issue(point: DocumentSyncPoint, text: DocumentTextSnapshot): DocumentRead {
    const revision: DocumentRevision = { point, [revisionBrand]: true }
    const read: DocumentRead = { revision, text: boundedRead(text) }
    this.issued.set(revision, { read, snapshot: text })
    this.wirePoint(point)
    return read
  }

  private wirePoint(point: DocumentSyncPoint): DocumentWorkerPoint {
    let segment = this.segments.get(point.segment)
    if (!segment) {
      segment = `${this.documentId}:${++this.nextSegment}`
      this.segments.set(point.segment, segment)
    }
    return { segment, revision: point.revision, textVersion: point.textVersion }
  }

  private async applySource(
    endpoint: DocumentSourceEndpoint,
    progress: ReaderProgress,
    command: DocumentWorkerSourceCommand,
    target: DocumentSyncPoint,
  ): Promise<boolean> {
    const result = await progress.connection.send(command, progress.cancellation.signal)
    if (this.disposed || this.endpoints.get(endpoint) !== progress) return false
    if (result.kind !== 'applied') throw admissionFailure(command, result)
    progress.point = target
    return true
  }
}

function resetSource(
  identity: DocumentWorkerIdentity,
  base: DocumentWorkerPoint | null,
  target: DocumentWorkerPoint,
  text: DocumentTextSnapshot,
): Extract<DocumentWorkerSourceCommand, { kind: 'reset' }> {
  const chunks: string[] = []
  text.forEachTextChunk((value) => chunks.push(value))
  return {
    kind: 'reset',
    identity,
    base,
    target,
    chunks,
    lineEnding: pieceTableLineEnding(text.snapshot),
    byteOrderMark: pieceTableByteOrderMark(text.snapshot),
    containsUnusualLineTerminators: pieceTableContainsUnusualLineTerminators(text.snapshot),
  }
}

function boundedRead(text: DocumentTextSnapshot): TextReadSnapshot {
  return {
    length: text.length,
    lineCount: text.lineCount,
    lineStart: (line) => text.lineStart(line),
    lineRange: (line) => text.lineRange(line),
    lineAt: (offset) => text.lineAt(offset),
    readRange: (start, end) => text.readRange(start, end),
    forEachTextChunk: (visit) => text.forEachTextChunk(visit),
  }
}

function admissionFailure(
  command: DocumentWorkerSourceCommand,
  result: DocumentWorkerSourceResult,
) {
  return createError({
    message: 'Document source admission failed',
    code: 'DOCUMENT_SOURCE_ADMISSION',
    status: 409,
    why: 'The worker rejected the requested source point.',
    fix: 'Reconnect the contribution and inspect its source acknowledgement.',
    internal: {
      command: command.kind,
      result: result.kind,
      reason: result.kind === 'rejected' ? result.reason : 'unexpected-reply',
      endpointGeneration: command.identity.endpointGeneration,
      registrationId: command.identity.registrationId,
      revision: 'target' in command ? command.target.revision : null,
    },
  })
}

function scopeWait<T>(
  task: Promise<T>,
  signal: AbortSignal,
  release?: (value: T) => void | Promise<void>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(new DOMException('Document contribution scope was released', 'AbortError'))
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    void task
      .then((value) => {
        if (!signal.aborted) {
          resolve(value)
          return
        }
        void Promise.resolve(release?.(value)).catch(() => undefined)
      }, reject)
      .finally(() => signal.removeEventListener('abort', abort))
  })
}

function projectionReceiptMatches(
  receipt: DocumentProjectionReceipt,
  identity: DocumentWorkerIdentity,
  base: DocumentWorkerPoint | null,
  target: DocumentWorkerPoint,
): boolean {
  return (
    (receipt.kind === 'applied' || receipt.kind === 'delivered') &&
    receipt.identity.documentId === identity.documentId &&
    receipt.identity.documentGeneration === identity.documentGeneration &&
    receipt.identity.endpointGeneration === identity.endpointGeneration &&
    receipt.identity.registrationId === identity.registrationId &&
    pointsEqual(receipt.base, base) &&
    pointsEqual(receipt.target, target)
  )
}
function pointsEqual(left: DocumentWorkerPoint | null, right: DocumentWorkerPoint | null): boolean {
  return (
    left === right ||
    Boolean(
      left &&
      right &&
      left.segment === right.segment &&
      left.revision === right.revision &&
      left.textVersion === right.textVersion,
    )
  )
}
