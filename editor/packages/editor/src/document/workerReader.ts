export { createEditorSnapshotBuffer } from '../documentSession'
import {
  applyBatchToPieceTable,
  createPieceTableSnapshot,
  retainPieceTableSnapshot,
  type DocumentLineEnding,
  type PieceTableSnapshot,
} from '@singapore-editor/textbuffer'
import { createDocumentTextSnapshot, type DocumentTextSnapshot } from '../documentTextSnapshot'
import type { TextEdit } from '../tokens'
import { createError } from '../logging/errors'
export { DocumentDelivery } from '../editor/documentDelivery'
export type {
  DocumentContributionSource,
  DocumentRead,
  DocumentRevision,
  DocumentSourceConnection,
  DocumentSourceEndpoint,
  PreparedDocumentWorkerRead,
} from '../editor/documentDelivery'

export type DocumentWorkerIdentity = {
  readonly documentId: string
  readonly documentGeneration: number
  readonly endpointGeneration: number
  readonly registrationId: number
}

export type DocumentWorkerPoint = {
  readonly segment: string
  readonly revision: number
  readonly textVersion: number
}

export type DocumentWorkerSourceCommand =
  | { readonly kind: 'register'; readonly identity: DocumentWorkerIdentity }
  | {
      readonly kind: 'pin'
      readonly identity: DocumentWorkerIdentity
      readonly point: DocumentWorkerPoint
      readonly readId: string
    }
  | { readonly kind: 'unpin'; readonly identity: DocumentWorkerIdentity; readonly readId: string }
  | {
      readonly kind: 'importRead'
      readonly identity: DocumentWorkerIdentity
      readonly point: DocumentWorkerPoint
      readonly readId: string
      readonly chunks: readonly string[]
      readonly lineEnding: DocumentLineEnding
      readonly byteOrderMark: string
      readonly containsUnusualLineTerminators: boolean
    }
  | {
      readonly kind: 'reset'
      readonly identity: DocumentWorkerIdentity
      readonly base: DocumentWorkerPoint | null
      readonly target: DocumentWorkerPoint
      readonly chunks: readonly string[]
      readonly lineEnding: DocumentLineEnding
      readonly byteOrderMark: string
      readonly containsUnusualLineTerminators: boolean
    }
  | {
      readonly kind: 'advance'
      readonly identity: DocumentWorkerIdentity
      readonly base: DocumentWorkerPoint
      readonly target: DocumentWorkerPoint
      readonly edits: readonly TextEdit[]
    }
  | {
      readonly kind: 'release'
      readonly identity: DocumentWorkerIdentity
    }

export type DocumentWorkerSourceResult =
  | { readonly kind: 'registered'; readonly identity: DocumentWorkerIdentity }
  | { readonly kind: 'pinned'; readonly reference: DocumentWorkerReadReference }
  | {
      readonly kind: 'applied'
      readonly identity: DocumentWorkerIdentity
      readonly base: DocumentWorkerPoint | null
      readonly target: DocumentWorkerPoint
    }
  | { readonly kind: 'released'; readonly identity: DocumentWorkerIdentity }
  | {
      readonly kind: 'rejected'
      readonly identity: DocumentWorkerIdentity
      readonly reason: 'disposed' | 'detached' | 'generation' | 'base' | 'point' | 'unavailable'
    }

export type DocumentWorkerReadReference = {
  readonly identity: DocumentWorkerIdentity
  readonly point: DocumentWorkerPoint
  readonly readId: string
}

export type DocumentWorkerRead = Omit<DocumentWorkerReadReference, 'readId'> & {
  readonly text: DocumentTextSnapshot
  isValid(): boolean
  retain(): DocumentWorkerRead | null
  dispose(): void
}

type SourceDocument = {
  readonly identity: DocumentWorkerIdentity
  frame: { readonly point: DocumentWorkerPoint; readonly snapshot: PieceTableSnapshot } | null
  readonly reads: Set<DocumentWorkerRead>
  readonly pins: Map<string, DocumentWorkerRead>
}

export function documentWorkerPointsEqual(
  left: DocumentWorkerPoint | null,
  right: DocumentWorkerPoint | null,
): boolean {
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

function identitiesEqual(left: DocumentWorkerIdentity, right: DocumentWorkerIdentity): boolean {
  return (
    left.documentId === right.documentId &&
    left.documentGeneration === right.documentGeneration &&
    left.endpointGeneration === right.endpointGeneration &&
    left.registrationId === right.registrationId
  )
}

function validPoint(point: unknown): point is DocumentWorkerPoint {
  return (
    typeof point === 'object' &&
    point !== null &&
    'segment' in point &&
    typeof point.segment === 'string' &&
    point.segment.length > 0 &&
    'revision' in point &&
    validOrdinal(point.revision, 0) &&
    'textVersion' in point &&
    validOrdinal(point.textVersion, 0)
  )
}

function validIdentity(identity: unknown): identity is DocumentWorkerIdentity {
  return (
    typeof identity === 'object' &&
    identity !== null &&
    'documentId' in identity &&
    typeof identity.documentId === 'string' &&
    identity.documentId.length > 0 &&
    'documentGeneration' in identity &&
    validOrdinal(identity.documentGeneration, 1) &&
    'endpointGeneration' in identity &&
    validOrdinal(identity.endpointGeneration, 1) &&
    'registrationId' in identity &&
    validOrdinal(identity.registrationId, 1)
  )
}

function validOrdinal(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
}

function validReference(reference: unknown): reference is DocumentWorkerReadReference {
  return (
    typeof reference === 'object' &&
    reference !== null &&
    'identity' in reference &&
    validIdentity(reference.identity) &&
    'point' in reference &&
    validPoint(reference.point) &&
    'readId' in reference &&
    typeof reference.readId === 'string' &&
    reference.readId.length > 0
  )
}

function isSourceReply(value: unknown): value is DocumentWorkerSourceResult {
  if (typeof value !== 'object' || value === null || !('kind' in value)) return false
  if (value.kind === 'pinned') return 'reference' in value && validReference(value.reference)
  if (!('identity' in value) || !validIdentity(value.identity)) return false
  if (value.kind === 'registered' || value.kind === 'released') return true
  if (value.kind === 'applied')
    return (
      'target' in value &&
      validPoint(value.target) &&
      'base' in value &&
      (value.base === null || validPoint(value.base))
    )
  if (value.kind !== 'rejected' || !('reason' in value)) return false
  return (
    value.reason === 'disposed' ||
    value.reason === 'detached' ||
    value.reason === 'generation' ||
    value.reason === 'base' ||
    value.reason === 'point' ||
    value.reason === 'unavailable'
  )
}

function replyMatches(
  command: DocumentWorkerSourceCommand,
  result: DocumentWorkerSourceResult,
): boolean {
  if (result.kind === 'pinned')
    return (
      (command.kind === 'pin' || command.kind === 'importRead') &&
      identitiesEqual(command.identity, result.reference.identity) &&
      documentWorkerPointsEqual(command.point, result.reference.point) &&
      command.readId === result.reference.readId
    )
  if (!identitiesEqual(command.identity, result.identity)) return false
  if (result.kind === 'rejected') return true
  if (result.kind === 'registered') return command.kind === 'register'
  if (result.kind === 'released') return command.kind === 'release' || command.kind === 'unpin'
  if (command.kind !== 'reset' && command.kind !== 'advance') return false
  return (
    documentWorkerPointsEqual(command.base, result.base) &&
    documentWorkerPointsEqual(command.target, result.target)
  )
}

export function decodeDocumentWorkerReply(
  command: DocumentWorkerSourceCommand,
  value: unknown,
): DocumentWorkerSourceResult {
  if (isSourceReply(value) && replyMatches(command, value)) return value
  throw createError({
    message: 'Document source acknowledgement failed',
    code: 'DOCUMENT_SOURCE_ACKNOWLEDGEMENT',
    status: 409,
    why: 'The reply does not match the source operation and its scope.',
    fix: 'Reconnect the contribution and inspect the worker protocol.',
    internal: {
      operation: command.kind,
      endpointGeneration: command.identity.endpointGeneration,
      registrationId: command.identity.registrationId,
    },
  })
}

function olderPoint(target: DocumentWorkerPoint, current: DocumentWorkerPoint): boolean {
  return target.revision < current.revision || target.textVersion < current.textVersion
}

export class DocumentWorkerReader {
  private readonly documents = new Map<string, SourceDocument>()
  private lastRegistration = 0
  private endpointGeneration: number | null = null
  private disposed = false

  public apply(command: DocumentWorkerSourceCommand): DocumentWorkerSourceResult {
    if (this.disposed) return rejected(command.identity, 'disposed')
    if (!validIdentity(command.identity)) return rejected(command.identity, 'generation')
    if (command.kind === 'register') return this.register(command.identity)
    if (command.kind === 'reset') return this.reset(command)
    const document = this.documents.get(command.identity.documentId)
    if (!document) return rejected(command.identity, 'detached')
    if (!identitiesEqual(document.identity, command.identity))
      return rejected(command.identity, 'generation')
    if (command.kind === 'importRead') {
      if (!validPoint(command.point) || document.pins.has(command.readId))
        return rejected(command.identity, 'point')
      const read = this.createRead(document, command.point, resetSnapshot(command))
      document.pins.set(command.readId, read)
      return {
        kind: 'pinned',
        reference: { identity: command.identity, point: command.point, readId: command.readId },
      }
    }
    if (command.kind === 'pin') {
      if (document.pins.has(command.readId)) return rejected(command.identity, 'point')
      const read = this.acquire({ identity: command.identity, point: command.point })
      if (!read) return rejected(command.identity, 'unavailable')
      document.pins.set(command.readId, read)
      return {
        kind: 'pinned',
        reference: { identity: command.identity, point: command.point, readId: command.readId },
      }
    }
    if (command.kind === 'unpin') {
      const read = document.pins.get(command.readId)
      document.pins.delete(command.readId)
      read?.dispose()
      return { kind: 'released', identity: command.identity }
    }
    if (command.kind === 'release') {
      this.release(document)
      return { kind: 'released', identity: command.identity }
    }
    const frame = document.frame
    if (!frame) return rejected(command.identity, 'detached')
    if (!documentWorkerPointsEqual(frame.point, command.base))
      return rejected(command.identity, 'base')
    if (!validPoint(command.target) || command.target.segment !== command.base.segment)
      return rejected(command.identity, 'point')
    if (olderPoint(command.target, command.base)) return rejected(command.identity, 'unavailable')
    document.frame = {
      snapshot: applyBatchToPieceTable(frame.snapshot, command.edits),
      point: command.target,
    }
    return {
      kind: 'applied',
      identity: command.identity,
      base: command.base,
      target: command.target,
    }
  }

  public acquire(
    reference: Omit<DocumentWorkerReadReference, 'readId'> & { readonly readId?: string },
  ): DocumentWorkerRead | null {
    if (this.disposed) return null
    const document = this.documents.get(reference.identity.documentId)
    if (!document || !identitiesEqual(document.identity, reference.identity)) return null
    if (reference.readId) {
      const pin = document.pins.get(reference.readId)
      if (!pin || !documentWorkerPointsEqual(pin.point, reference.point)) return null
    }
    const snapshot =
      document.frame && documentWorkerPointsEqual(document.frame.point, reference.point)
        ? document.frame.snapshot
        : retainedSnapshot(document, reference.point)
    if (!snapshot) return null
    return this.createRead(document, reference.point, snapshot)
  }

  private createRead(
    document: SourceDocument,
    point: DocumentWorkerPoint,
    snapshot: PieceTableSnapshot,
  ): DocumentWorkerRead {
    const text = createDocumentTextSnapshot(retainPieceTableSnapshot(snapshot))
    let released = false
    const read: DocumentWorkerRead = {
      identity: document.identity,
      point,
      text,
      isValid: () =>
        !released &&
        !this.disposed &&
        this.documents.get(document.identity.documentId) === document,
      retain: () =>
        read.isValid() ? this.acquire({ identity: read.identity, point: read.point }) : null,
      dispose: () => {
        if (released) return
        released = true
        document.reads.delete(read)
      },
    }
    document.reads.add(read)
    return read
  }

  public inspect(): {
    readonly documents: number
    readonly reads: number
    readonly pins: number
    readonly sourceUnits: number
  } {
    let reads = 0
    let pins = 0
    const roots = new Map<PieceTableSnapshot['root'], number>()
    for (const document of this.documents.values()) {
      reads += document.reads.size
      pins += document.pins.size
      if (document.frame) roots.set(document.frame.snapshot.root, document.frame.snapshot.length)
      for (const read of document.reads) roots.set(read.text.snapshot.root, read.text.length)
    }
    let sourceUnits = 0
    for (const units of roots.values()) sourceUnits += units
    return { documents: this.documents.size, reads, pins, sourceUnits }
  }

  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const document of this.documents.values()) this.release(document)
    this.documents.clear()
  }

  private reset(
    command: Extract<DocumentWorkerSourceCommand, { kind: 'reset' }>,
  ): DocumentWorkerSourceResult {
    const previous = this.documents.get(command.identity.documentId)
    if (!previous) return rejected(command.identity, 'detached')
    if (!identitiesEqual(previous.identity, command.identity))
      return rejected(command.identity, 'generation')
    if (!validPoint(command.target)) return rejected(command.identity, 'point')
    const frame = previous.frame
    if (!documentWorkerPointsEqual(frame?.point ?? null, command.base))
      return rejected(command.identity, 'base')
    if (frame && olderPoint(command.target, frame.point))
      return rejected(command.identity, 'unavailable')
    const snapshot = resetSnapshot(command)
    previous.frame = { snapshot, point: command.target }
    return {
      kind: 'applied',
      identity: command.identity,
      base: command.base,
      target: command.target,
    }
  }

  private register(identity: DocumentWorkerIdentity): DocumentWorkerSourceResult {
    if (this.endpointGeneration !== null && identity.endpointGeneration !== this.endpointGeneration)
      return rejected(identity, 'generation')
    if (identity.registrationId <= this.lastRegistration) return rejected(identity, 'generation')
    const previous = this.documents.get(identity.documentId)
    if (previous && identity.documentGeneration < previous.identity.documentGeneration)
      return rejected(identity, 'generation')
    if (previous) this.release(previous)
    this.endpointGeneration = identity.endpointGeneration
    this.lastRegistration = identity.registrationId
    this.documents.set(identity.documentId, {
      identity,
      frame: null,
      reads: new Set(),
      pins: new Map(),
    })
    return { kind: 'registered', identity }
  }

  private release(document: SourceDocument): void {
    for (const read of document.reads) read.dispose()
    document.pins.clear()
    this.documents.delete(document.identity.documentId)
  }
}

function retainedSnapshot(
  document: SourceDocument,
  point: DocumentWorkerPoint,
): PieceTableSnapshot | null {
  for (const read of document.reads) {
    if (documentWorkerPointsEqual(read.point, point)) return read.text.snapshot
  }
  return null
}

function resetSnapshot(
  command: Extract<DocumentWorkerSourceCommand, { kind: 'reset' | 'importRead' }>,
): PieceTableSnapshot {
  let snapshot = createPieceTableSnapshot('', {
    normalized: true,
    transient: true,
    lineEnding: command.lineEnding,
    byteOrderMark: command.byteOrderMark,
    containsUnusualLineTerminators: command.containsUnusualLineTerminators,
  })
  for (const text of command.chunks) {
    if (!text.length) continue
    snapshot = applyBatchToPieceTable(snapshot, [
      { from: snapshot.length, to: snapshot.length, text },
    ])
  }
  return retainPieceTableSnapshot(snapshot)
}

function rejected(
  identity: DocumentWorkerIdentity,
  reason: Extract<DocumentWorkerSourceResult, { kind: 'rejected' }>['reason'],
): DocumentWorkerSourceResult {
  return { kind: 'rejected', identity, reason }
}

export {
  defineDocumentOperation,
  defineStructuralOperation,
  defineHighlighterOperation,
} from '../editor/operationDefinitions'
export { acquireEditorDocumentAnalysis } from '../editor/documentAnalysis'
export type {
  StructuralOperationContext,
  HighlighterOperationContext,
} from '../editor/operationDefinitions'

export type {
  DocumentOperationContext,
  DocumentOperationRuntime,
} from '../editor/operationDefinitions'

export type {
  DocumentProjectionEndpoint,
  DocumentProjectionConnection,
  DocumentProjectionUpdate,
  DocumentProjectionReceipt,
} from '../editor/documentDelivery'

export { waitForDocumentWork } from '../editor/documentWork'
