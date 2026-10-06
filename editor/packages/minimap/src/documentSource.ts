import type { EditorDocumentContributions } from '@singapore-editor/core/editor'
import {
  defineDocumentOperation,
  type DocumentOperationContext,
  type DocumentProjectionConnection,
  type DocumentProjectionReceipt,
  type DocumentProjectionUpdate,
  type DocumentWorkerIdentity,
} from '@singapore-editor/core/internal/document-worker'
import { createError } from '@singapore-editor/core/logging/evlog'
import { sourceIdentitiesEqual } from './sourceIdentity'
import {
  documentSummaryPayload,
  documentSummaryPatchPayload,
  sequentialMinimapEdits,
  summarySource,
} from './summary'
import type { MinimapSourceProjection, MinimapWorkerRequest, MinimapWorkerResponse } from './types'
import {
  MinimapWorkerOwner,
  type MinimapWorkerOwnerOptions,
  type MinimapWorkerOwnerSnapshot,
} from './workerOwner'

type PendingProjection = {
  readonly identity: DocumentWorkerIdentity
  readonly tokensRebased: boolean
  resolve(receipt: DocumentProjectionReceipt): void
  reject(error: unknown): void
  detach(): void
}

export type MinimapSourceResult = {
  readonly point: DocumentProjectionUpdate['read']['revision']['point']
  readonly receipt: DocumentProjectionReceipt
  readonly tokensRebased: boolean
}

let nextWorkerGeneration = 0

const minimapDocumentOperation = defineDocumentOperation(
  (context, source: MinimapDocumentSource) => source.bind(context),
  (left, right) => left === right,
)

export function retainMinimapDocumentSource(
  contributions: EditorDocumentContributions,
  options: MinimapWorkerOwnerOptions & { readonly maxColumn: number },
) {
  const source = new MinimapDocumentSource(options)
  const lease = contributions.retain(minimapDocumentOperation, source)
  return lease ? { source, lease } : null
}

class MinimapDocumentSource {
  private worker: MinimapWorkerOwner | null = null
  private connection: DocumentProjectionConnection | null = null
  private nextRegistration = 0
  private nextRequest = 0
  private tokensRebased = false
  private readonly pending = new Map<number, PendingProjection>()

  public constructor(
    private readonly options: MinimapWorkerOwnerOptions & { readonly maxColumn: number },
  ) {}

  public bind(context: DocumentOperationContext) {
    this.worker = new MinimapWorkerOwner({
      ...this.options,
      onMessage: this.handleMessage,
      onError: this.handleError,
    })
    this.connection = {
      generation: ++nextWorkerGeneration,
      nextRegistration: () => ++this.nextRegistration,
      admit: this.admit,
      release: this.release,
    }
    return {
      analyze: async (
        read: DocumentProjectionUpdate['read'],
      ): Promise<MinimapSourceResult | null> => {
        const point = read.revision.point
        const receipt = await context.source.prepareProjection(this, read)
        return receipt ? { point, receipt, tokensRebased: this.tokensRebased } : null
      },
      dispose: () => this.dispose(),
    }
  }

  public connect(): Promise<DocumentProjectionConnection | null> {
    return Promise.resolve(this.connection)
  }

  public inspect(): MinimapWorkerOwnerSnapshot {
    return this.worker?.inspect() ?? { lifecycle: 'disposed', postedRequests: 0, lastError: null }
  }

  public post(request: MinimapWorkerRequest, transfer?: Transferable[]): boolean {
    const posted = this.worker?.post(request, transfer) ?? false
    if (posted && request.type === 'updateTokens') this.tokensRebased = true
    return posted
  }

  private readonly admit = (
    update: DocumentProjectionUpdate,
    signal: AbortSignal,
  ): Promise<DocumentProjectionReceipt> => {
    if (signal.aborted) return Promise.reject(cancelledProjection())
    const request: Extract<MinimapWorkerRequest, { type: 'projectSource' }> = {
      type: 'projectSource',
      requestId: ++this.nextRequest,
      identity: update.identity,
      base: update.base,
      target: update.target,
      projection: projectSource(update, this.options.maxColumn),
    }
    return new Promise((resolve, reject) => {
      const abort = () => this.rejectRequest(request.requestId, cancelledProjection())
      signal.addEventListener('abort', abort, { once: true })
      this.pending.set(request.requestId, {
        identity: request.identity,
        tokensRebased: projectionPreservesTokenCoordinates(update),
        resolve,
        reject,
        detach: () => signal.removeEventListener('abort', abort),
      })
      if (this.post(request)) return
      this.rejectRequest(request.requestId, projectionPostFailure(request))
    })
  }

  private readonly release = (identity: DocumentWorkerIdentity): void => {
    this.post({ type: 'releaseSource', identity })
    for (const [requestId, pending] of this.pending) {
      if (!sourceIdentitiesEqual(pending.identity, identity)) continue
      this.rejectRequest(requestId, cancelledProjection())
    }
  }

  private readonly handleMessage = (response: MinimapWorkerResponse): void => {
    if (response.type !== 'sourceApplied') {
      this.options.onMessage(response)
      return
    }
    const pending = this.pending.get(response.requestId)
    if (!pending) return
    this.pending.delete(response.requestId)
    pending.detach()
    this.tokensRebased = this.tokensRebased && pending.tokensRebased
    pending.resolve(response.receipt)
  }

  private readonly handleError = (error: Error): void => {
    for (const requestId of this.pending.keys()) this.rejectRequest(requestId, error)
    this.options.onError?.(error)
  }

  private rejectRequest(requestId: number, error: unknown): void {
    const pending = this.pending.get(requestId)
    if (!pending) return
    this.pending.delete(requestId)
    pending.detach()
    pending.reject(error)
  }

  private dispose(): void {
    this.connection = null
    for (const requestId of this.pending.keys())
      this.rejectRequest(requestId, cancelledProjection())
    void this.worker?.dispose().catch(this.handleError)
  }
}

function projectSource(
  update: DocumentProjectionUpdate,
  maxColumn: number,
): MinimapSourceProjection {
  const base = update.baseRead?.text
  const canonical = update.changes?.edits
  if (!base || !canonical) {
    return { kind: 'reset', summary: documentSummaryPayload(update.read.text, maxColumn) }
  }
  const edits = sequentialMinimapEdits(canonical)
  return {
    kind: 'patch',
    edits,
    summary: documentSummaryPatchPayload(update.read.text, summarySource(base), edits, maxColumn, {
      textLength: base.length,
      lineCount: base.lineCount,
    }),
  }
}

function projectionPreservesTokenCoordinates(update: DocumentProjectionUpdate): boolean {
  const base = update.baseRead?.text
  const edits = update.changes?.edits
  return Boolean(
    base &&
    edits &&
    edits.every(
      (edit) => !edit.text.includes('\n') && base.lineAt(edit.from) === base.lineAt(edit.to),
    ),
  )
}

function cancelledProjection(): DOMException {
  return new DOMException('Minimap document source was released', 'AbortError')
}

function projectionPostFailure(request: Extract<MinimapWorkerRequest, { type: 'projectSource' }>) {
  return createError({
    code: 'minimap.SOURCE_POST_FAILED',
    message: 'Minimap source request failed',
    why: 'The worker stopped accepting projected source requests.',
    fix: 'Reopen the document to create a fresh minimap worker.',
    internal: {
      requestId: request.requestId,
      endpointGeneration: request.identity.endpointGeneration,
    },
  })
}
