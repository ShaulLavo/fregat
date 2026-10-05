import type { DocumentRead, DocumentRevision } from './documentDelivery'
import {
  bindDocumentOperation,
  leaseDocumentOperation,
  type ContributionEntry,
  type DocumentOperation,
  type DocumentOperationHost,
  type DocumentOperationOptions,
} from './contributionOperation'
import { createError, type EditorEvlogError } from '../logging/errors'

export type DocumentContributionOutcome<Result> =
  | { readonly kind: 'completed'; readonly revision: DocumentRevision; readonly result: Result }
  | { readonly kind: 'cancelled' | 'superseded' | 'disposed' | 'unavailable' }
  | { readonly kind: 'failed'; readonly failure: EditorEvlogError }
export type DocumentContributionTask<Result> = {
  readonly settled: Promise<DocumentContributionOutcome<Result>>
  cancel(): void
  dispose(): void
}
export type DocumentContributionDemand<Result> = DocumentOperationOptions & (
  | { readonly kind: 'latest'; readonly audience: DocumentContributionAudience; readonly accept?: (result: Result) => void }
  | { readonly kind: 'pinned'; readonly owner: DocumentContributionOwner; readonly accept?: (result: Result) => void }
)

type StopReason = 'cancelled' | 'superseded' | 'disposed'
const authority = Symbol('document.contribution.authority')

class ContributionLifetime {
  readonly cancellation = new AbortController()
  constructor(readonly host: DocumentOperationHost, signal?: AbortSignal) {
    const release = () => this.dispose()
    host.signal.addEventListener('abort', release, { once: true })
    signal?.addEventListener('abort', release, { once: true })
    this.cancellation.signal.addEventListener('abort', () => {
      host.signal.removeEventListener('abort', release)
      signal?.removeEventListener('abort', release)
    }, { once: true })
    if (host.signal.aborted || signal?.aborted) release()
  }
  dispose(): void { this.cancellation.abort() }
}

export class DocumentContributionAudience {
  private sequence = 0
  private stop: ((reason: StopReason) => void) | null = null
  private constructor(private readonly lifetime: ContributionLifetime) {}
  static issue(host: DocumentOperationHost, signal?: AbortSignal): DocumentContributionAudience {
    return new DocumentContributionAudience(new ContributionLifetime(host, signal))
  }
  [authority](host: DocumentOperationHost, stop: (reason: StopReason) => void) {
    if (host !== this.lifetime.host || this.lifetime.cancellation.signal.aborted) return null
    this.stop?.('superseded')
    this.stop = stop
    const sequence = ++this.sequence
    return { signal: this.lifetime.cancellation.signal, current: () => sequence === this.sequence, release: () => { if (sequence === this.sequence) this.stop = null } }
  }
  dispose(): void { this.lifetime.dispose() }
}

export class DocumentContributionOwner {
  private read: DocumentRead | null
  private readonly entries = new Set<Pick<ContributionEntry<unknown>, 'leaseCount' | 'dispose' | 'signal'>>()
  readonly revision: DocumentRevision
  private constructor(private readonly lifetime: ContributionLifetime, read: DocumentRead) {
    this.read = read
    this.revision = read.revision
    lifetime.cancellation.signal.addEventListener('abort', () => {
      this.read = null
      for (const entry of this.entries) if (entry.leaseCount === 0) entry.dispose()
      this.entries.clear()
    }, { once: true })
  }
  static issue(host: DocumentOperationHost, signal?: AbortSignal): DocumentContributionOwner | null {
    if (host.signal.aborted || signal?.aborted) return null
    const read = host.delivery.current()
    return read ? new DocumentContributionOwner(new ContributionLifetime(host, signal), read) : null
  }
  [authority](host: DocumentOperationHost) {
    if (host !== this.lifetime.host || !this.read || this.lifetime.cancellation.signal.aborted) return null
    return { signal: this.lifetime.cancellation.signal, read: this.read, retain: (entry: Pick<ContributionEntry<unknown>, 'leaseCount' | 'dispose' | 'signal'>) => {
      if (this.entries.has(entry)) return
      this.entries.add(entry)
      entry.signal.addEventListener('abort', () => this.entries.delete(entry), { once: true })
    } }
  }
  dispose(): void { this.lifetime.dispose() }
}

export function requestDocumentContribution<Input, Result, Entry extends ContributionEntry<Result>>(
  host: DocumentOperationHost,
  operation: DocumentOperation<Input, Result, Entry>,
  input: Input,
  demand: DocumentContributionDemand<Result>,
): DocumentContributionTask<Result> {
  const cancellation = new AbortController()
  let resolve: (outcome: DocumentContributionOutcome<Result>) => void = () => {}
  let completed = false
  const settled = new Promise<DocumentContributionOutcome<Result>>(done => { resolve = done })
  const finish = (outcome: DocumentContributionOutcome<Result>) => {
    if (completed) return
    completed = true
    resolve(outcome)
    cancellation.abort()
  }
  const stop = (kind: StopReason) => finish({ kind })
  const latest = demand.kind === 'latest' ? demand.audience[authority](host, stop) : null
  const pinned = demand.kind === 'pinned' ? demand.owner[authority](host) : null
  const lifetime = latest?.signal ?? pinned?.signal
  const read = pinned?.read ?? host.delivery.current()
  const task = { settled, cancel: () => stop('cancelled'), dispose: () => stop('disposed') }
  if (!read || !lifetime || lifetime.aborted || host.signal.aborted) { finish({ kind: 'unavailable' }); return task }
  const dispose = () => stop('disposed')
  const cancel = () => stop('cancelled')
  lifetime.addEventListener('abort', dispose, { once: true })
  demand.signal?.addEventListener('abort', cancel, { once: true })
  const cleanup = () => {
    latest?.release()
    lifetime.removeEventListener('abort', dispose)
    demand.signal?.removeEventListener('abort', cancel)
  }
  if (demand.signal?.aborted) { stop('cancelled'); cleanup(); return task }
  const entry = bindDocumentOperation(operation, host, input, { ...demand, signal: cancellation.signal }, demand.kind === 'pinned' ? demand.owner : null)
  if (!entry) { finish({ kind: 'unavailable' }); cleanup(); return task }
  pinned?.retain(entry)
  const lease = leaseDocumentOperation(operation, entry, cancellation.signal)
  const result = leaseWait(entry.at(read), cancellation.signal)
  void result.then(value => {
    if (completed) return
    if (!host.delivery.read(read.revision) || latest && (!latest.current() || host.buffer.getDocumentSyncPoint() !== read.revision.point)) {
      finish({ kind: 'superseded' }); return
    }
    demand.accept?.(value)
    finish({ kind: 'completed', result: value, revision: read.revision })
  }).catch(error => {
    if (completed) return
    if (error instanceof DOMException && error.name === 'AbortError') { finish({ kind: 'superseded' }); return }
    finish({ kind: 'failed', failure: createError({
      message: 'Document contribution failed', code: 'DOCUMENT_CONTRIBUTION_FAILED', status: 500,
      why: 'The contribution could not complete its captured request.', fix: 'Inspect the contribution diagnostics.',
      cause: error instanceof Error ? error : undefined,
      internal: { runtimeSessionId: entry.runtimeSessionId, revision: read.revision.point.revision },
    }) })
  }).finally(() => {
    lease.dispose()
    if (pinned && lifetime.aborted && entry.leaseCount === 0) entry.dispose()
    cleanup()
  })
  return task
}

function leaseWait<Result>(result: Promise<Result>, signal: AbortSignal): Promise<Result> {
  if (signal.aborted) { void result.catch(() => {}); return Promise.reject(new DOMException('Document contribution was released', 'AbortError')) }
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Document contribution was released', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    void result.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
