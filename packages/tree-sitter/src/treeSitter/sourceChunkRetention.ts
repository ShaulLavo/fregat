import type { PieceTableSnapshot } from '@singapore-editor/core/document'
import { createTreeSitterSourceDescriptor, type TreeSitterSourceDescriptor } from './source'

export type TreeSitterSourceChunkRetentionSnapshot = {
  readonly documents: number
  readonly sentChunks: number
  readonly sourceEpochs: number
}

export type TreeSitterSourceChunkRequest = {
  readonly documentId: string
  readonly source: TreeSitterSourceDescriptor
  readonly epoch: number
}

export class TreeSitterSourceChunkRetention {
  // chunkId → sent length. Buffers are append-only, so a chunk id with an
  // unchanged length is byte-identical to what the worker already caches; a
  // longer length means the tail chunk grew and must be re-sent.
  private readonly sentSourceChunkLengths = new Map<string, Map<string, number>>()
  private readonly sourceDocumentEpochs = new Map<string, number>()
  // The worker keeps only the chunks of the last descriptor it received; see keepReferencedChunks.
  // Pieces identify a descriptor without pinning its payload text.
  private readonly latestDescriptors = new Map<string, TreeSitterSourceDescriptor['pieces']>()

  public createDescriptor(
    documentId: string,
    snapshot: PieceTableSnapshot,
  ): TreeSitterSourceDescriptor {
    const sent = this.sourceChunkLengthsForDocument(documentId)
    const descriptor = createTreeSitterSourceDescriptor(snapshot, { sentChunkLengths: sent })
    const referenced = new Set(descriptor.pieces.map((piece) => piece.chunkId))
    for (const chunkId of sent.keys()) {
      if (!referenced.has(chunkId)) sent.delete(chunkId)
    }
    this.latestDescriptors.set(documentId, descriptor.pieces)
    return descriptor
  }

  public createRequest(
    documentId: string,
    source: TreeSitterSourceDescriptor,
  ): TreeSitterSourceChunkRequest {
    return {
      documentId,
      source,
      epoch: this.currentSourceEpoch(documentId),
    }
  }

  public markRequestSent(request: TreeSitterSourceChunkRequest | null): void {
    if (!request) return
    if (!this.canMarkRequestSent(request)) return

    const sent = this.sourceChunkLengthsForDocument(request.documentId)
    for (const chunk of request.source.chunks) {
      sent.set(chunk.chunkId, chunk.text.length)
    }
  }

  public invalidateDocument(documentId: string): void {
    if (!this.hasDocumentState(documentId)) return

    this.sentSourceChunkLengths.delete(documentId)
    this.latestDescriptors.delete(documentId)
    this.sourceDocumentEpochs.set(documentId, this.currentSourceEpoch(documentId) + 1)
  }

  public clear(): void {
    this.sentSourceChunkLengths.clear()
    this.latestDescriptors.clear()
    this.sourceDocumentEpochs.clear()
  }

  public inspect(): TreeSitterSourceChunkRetentionSnapshot {
    return {
      documents: this.documentCount(),
      sentChunks: this.sentChunkCount(),
      sourceEpochs: this.sourceDocumentEpochs.size,
    }
  }

  private sourceChunkLengthsForDocument(documentId: string): Map<string, number> {
    const existing = this.sentSourceChunkLengths.get(documentId)
    if (existing) return existing

    const sent = new Map<string, number>()
    this.sentSourceChunkLengths.set(documentId, sent)
    return sent
  }

  // An older response may name chunks a newer descriptor has since told the worker to drop.
  private canMarkRequestSent(request: TreeSitterSourceChunkRequest): boolean {
    if (request.epoch !== this.currentSourceEpoch(request.documentId)) return false
    return this.latestDescriptors.get(request.documentId) === request.source.pieces
  }

  private currentSourceEpoch(documentId: string): number {
    return this.sourceDocumentEpochs.get(documentId) ?? 0
  }

  private hasDocumentState(documentId: string): boolean {
    if (this.sentSourceChunkLengths.has(documentId)) return true
    return this.sourceDocumentEpochs.has(documentId)
  }

  private documentCount(): number {
    return new Set([...this.sentSourceChunkLengths.keys(), ...this.sourceDocumentEpochs.keys()])
      .size
  }

  private sentChunkCount(): number {
    let count = 0
    for (const chunks of this.sentSourceChunkLengths.values()) count += chunks.size
    return count
  }
}
