import { waitForDocumentWork as leaseWait } from './documentWork'
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
export type DocumentContributionDemand<Result> = DocumentOperationOptions &
  (
    | {
        readonly kind: 'latest'
        readonly audience: DocumentContributionAudience
        readonly accept?: (result: Result) => void
      }
    | {
        readonly kind: 'pinned'
        readonly owner: DocumentContributionOwner
        readonly accept?: (result: Result) => void
      }
  )

type StopReason = 'cancelled' | 'superseded' | 'disposed'
const authority = Symbol('document.contribution.authority')

class ContributionLifetime {
  readonly cancellation = new AbortController()
  constructor(
    readonly host: DocumentOperationHost,
    signal?: AbortSignal,
  ) {
    const release = () => this.dispose()
    host.signal.addEventListener('abort', release, { once: true })
    signal?.addEventListener('abort', release, { once: true })
    this.cancellation.signal.addEventListener(
      'abort',
      () => {
        host.signal.removeEventListener('abort', release)
        signal?.removeEventListener('abort', release)
      },
      { once: true },
    )
    if (host.signal.aborted || signal?.aborted) release()
  }
  dispose(): void {
    this.cancellation.abort()
  }
}

export class DocumentContributionAudience {
  readonly #issued = true
  #sequence = 0
  #stop: ((reason: StopReason) => void) | null = null
  readonly #lifetime: ContributionLifetime
  private constructor(lifetime: ContributionLifetime) {
    this.#lifetime = lifetime
  }
  static issue(host: DocumentOperationHost, signal?: AbortSignal): DocumentContributionAudience {
    return new DocumentContributionAudience(new ContributionLifetime(host, signal))
  }
  [authority](host: DocumentOperationHost, stop: (reason: StopReason) => void) {
    if (!(#issued in this)) return null
    if (host !== this.#lifetime.host || this.#lifetime.cancellation.signal.aborted) return null
    this.#stop?.('superseded')
    this.#stop = stop
    const sequence = ++this.#sequence
    return {
      signal: this.#lifetime.cancellation.signal,
      current: () => sequence === this.#sequence,
      release: () => {
        if (sequence === this.#sequence) this.#stop = null
      },
    }
  }
  dispose(): void {
    if (#issued in this) this.#lifetime.dispose()
  }
}

export class DocumentContributionOwner {
  readonly #issued = true
  #read: DocumentRead | null
  readonly #entries = new Set<
    Pick<ContributionEntry<unknown>, 'leaseCount' | 'dispose' | 'signal'>
  >()
  readonly revision: DocumentRevision
  readonly #lifetime: ContributionLifetime
  private constructor(lifetime: ContributionLifetime, read: DocumentRead) {
    this.#lifetime = lifetime
    this.#read = read
    this.revision = read.revision
    lifetime.cancellation.signal.addEventListener(
      'abort',
      () => {
        this.#read = null
        for (const entry of this.#entries) if (entry.leaseCount === 0) entry.dispose()
        this.#entries.clear()
      },
      { once: true },
    )
  }
  static issue(
    host: DocumentOperationHost,
    signal?: AbortSignal,
  ): DocumentContributionOwner | null {
    if (host.signal.aborted || signal?.aborted) return null
    const read = host.delivery.current()
    return read ? new DocumentContributionOwner(new ContributionLifetime(host, signal), read) : null
  }
  [authority](host: DocumentOperationHost) {
    if (!(#issued in this)) return null
    if (host !== this.#lifetime.host || !this.#read || this.#lifetime.cancellation.signal.aborted)
      return null
    return {
      signal: this.#lifetime.cancellation.signal,
      read: this.#read,
      retain: (entry: Pick<ContributionEntry<unknown>, 'leaseCount' | 'dispose' | 'signal'>) => {
        if (this.#entries.has(entry)) return
        this.#entries.add(entry)
        entry.signal.addEventListener('abort', () => this.#entries.delete(entry), { once: true })
      },
    }
  }
  dispose(): void {
    if (#issued in this) this.#lifetime.dispose()
  }
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
  const settled = new Promise<DocumentContributionOutcome<Result>>((done) => {
    resolve = done
  })
  const finish = (outcome: DocumentContributionOutcome<Result>) => {
    if (completed) return
    completed = true
    resolve(outcome)
    cancellation.abort()
  }
  const stop = (kind: StopReason) => finish({ kind })
  const latest =
    demand.kind === 'latest' && demand.audience instanceof DocumentContributionAudience
      ? DocumentContributionAudience.prototype[authority].call(demand.audience, host, stop)
      : null
  const pinned =
    demand.kind === 'pinned' && demand.owner instanceof DocumentContributionOwner
      ? DocumentContributionOwner.prototype[authority].call(demand.owner, host)
      : null
  const lifetime = latest?.signal ?? pinned?.signal
  const read = pinned?.read ?? host.delivery.current()
  const task = { settled, cancel: () => stop('cancelled'), dispose: () => stop('disposed') }
  if (!read || !lifetime || lifetime.aborted || host.signal.aborted) {
    finish({ kind: 'unavailable' })
    return task
  }
  const dispose = () => stop('disposed')
  const cancel = () => stop('cancelled')
  lifetime.addEventListener('abort', dispose, { once: true })
  demand.signal?.addEventListener('abort', cancel, { once: true })
  const cleanup = () => {
    latest?.release()
    lifetime.removeEventListener('abort', dispose)
    demand.signal?.removeEventListener('abort', cancel)
  }
  if (demand.signal?.aborted) {
    stop('cancelled')
    cleanup()
    return task
  }
  let entry: Entry | null
  try {
    entry = bindDocumentOperation(
      operation,
      host,
      input,
      { ...demand, signal: cancellation.signal },
      demand.kind === 'pinned' ? demand.owner : null,
      read,
    )
  } catch (error) {
    finish({ kind: 'failed', failure: contributionFailure(error, null, read) })
    cleanup()
    return task
  }
  if (!entry) {
    finish({ kind: 'unavailable' })
    cleanup()
    return task
  }
  const bound = entry
  pinned?.retain(bound)
  const lease = leaseDocumentOperation(operation, bound, cancellation.signal)
  const result = leaseWait(bound.at(read), cancellation.signal)
  const generation = bound.analysisGeneration
  void result
    .then((value) => {
      if (completed) return
      if (
        generation !== bound.analysisGeneration ||
        !bound.isConfigurationCurrent() ||
        !host.delivery.read(read.revision) ||
        (latest &&
          (!latest.current() || host.buffer.getDocumentSyncPoint() !== read.revision.point))
      ) {
        finish({ kind: 'superseded' })
        return
      }
      demand.accept?.(value)
      finish({ kind: 'completed', result: value, revision: read.revision })
    })
    .catch((error) => {
      if (completed) return
      if (error instanceof DOMException && error.name === 'AbortError') {
        finish({ kind: 'superseded' })
        return
      }
      finish({ kind: 'failed', failure: contributionFailure(error, bound.runtimeSessionId, read) })
    })
    .finally(() => {
      lease.dispose()
      if (pinned && lifetime.aborted && bound.leaseCount === 0) bound.dispose()
      cleanup()
    })
  return task
}

function contributionFailure(
  error: unknown,
  runtimeSessionId: string | null,
  read: DocumentRead,
): EditorEvlogError {
  return createError({
    message: 'Document contribution failed',
    code: 'DOCUMENT_CONTRIBUTION_FAILED',
    status: 500,
    why: 'The contribution could not complete its captured request.',
    fix: 'Inspect the contribution diagnostics.',
    cause: error instanceof Error ? error : undefined,
    internal: { runtimeSessionId, revision: read.revision.point.revision },
  })
}
