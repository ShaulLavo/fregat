import type {
  DocumentProjectionReceipt,
  DocumentWorkerIdentity,
} from '@singapore-editor/core/internal/document-worker'
import { createError } from '@singapore-editor/core/logging/evlog'
import type { MinimapWorkerRequest } from './types'
import { MinimapWorkerRenderer } from './renderer'
import { sourceIdentitiesEqual, sourcePointsEqual } from './sourceIdentity'

export class MinimapSourceProtocol {
  private accepted: DocumentProjectionReceipt | null = null

  public constructor(private readonly renderer: MinimapWorkerRenderer) {}

  public apply(
    request: Extract<MinimapWorkerRequest, { type: 'projectSource' }>,
  ): DocumentProjectionReceipt {
    if (!this.matchesBase(request)) throw sourceMismatch(request)
    const projection = request.projection
    if (projection.kind === 'reset') {
      this.renderer.applySourceSummary(projection.summary)
    } else {
      this.renderer.applySourcePatch(projection.edits, projection.summary)
    }
    this.accepted = {
      kind: 'applied',
      identity: request.identity,
      base: request.base,
      target: request.target,
    }
    return this.accepted
  }

  public release(identity: DocumentWorkerIdentity): void {
    if (!this.accepted || !sourceIdentitiesEqual(identity, this.accepted.identity)) return
    this.accepted = null
    this.renderer.setDocument({
      textLength: 0,
      lineStarts: [0],
      lines: [{ text: '', length: 0 }],
      tokens: [],
      selections: [],
      decorations: [],
    })
  }

  public current(): DocumentProjectionReceipt | null {
    return this.accepted
  }

  public accepts(receipt: DocumentProjectionReceipt): boolean {
    return Boolean(
      this.accepted &&
      sourceIdentitiesEqual(receipt.identity, this.accepted.identity) &&
      sourcePointsEqual(receipt.target, this.accepted.target),
    )
  }

  private matchesBase(request: Extract<MinimapWorkerRequest, { type: 'projectSource' }>): boolean {
    if (!this.accepted) return request.base === null && request.projection.kind === 'reset'
    return (
      sourceIdentitiesEqual(request.identity, this.accepted.identity) &&
      sourcePointsEqual(request.base, this.accepted.target)
    )
  }
}

function sourceMismatch(request: Extract<MinimapWorkerRequest, { type: 'projectSource' }>) {
  return createError({
    code: 'minimap.SOURCE_BASE_MISMATCH',
    message: 'Minimap source baseline changed',
    why: 'The requested patch names another source scope or baseline.',
    fix: 'Release the stale source operation and reconnect the document projection.',
    internal: {
      requestId: request.requestId,
      endpointGeneration: request.identity.endpointGeneration,
      revision: request.target.revision,
    },
  })
}
