import type { EditorTextBuffer } from '../documentSession'
import type { DocumentDelivery, DocumentRead, DocumentContributionScope } from './documentDelivery'
import type { RetentionChanges, EditorAnalysisRead } from './documentAnalysis'
import type { EditorWorkScheduler } from './workScheduler'

export type DocumentOperationOptions = {
  readonly configurationTag?: readonly (string | number | boolean | null)[]
  readonly signal?: AbortSignal
}
export type DocumentContributionLease<Result> = {
  readonly runtimeSessionId: string
  request(): Promise<Result>
  read(): EditorAnalysisRead<Result>
  dispose(): void
}
export type ContributionEntry<Result> = {
  readonly runtimeSessionId: string
  readonly analysisGeneration: number
  readonly signal: AbortSignal
  readonly leaseCount: number
  readonly lastLeaseReleasedAt: number | null
  activate(): void
  changed(read: DocumentRead): void
  current(): Promise<Result>
  at(read: DocumentRead): Promise<Result>
  isConfigurationCurrent(): boolean
  read(): EditorAnalysisRead<Result>
  lease(signal?: AbortSignal): {
    readonly signal: AbortSignal
    wait<T>(run: () => Promise<T>): Promise<T>
    dispose(): void
  }
  dispose(): void
}
export type DocumentOperationHost = {
  readonly buffer: EditorTextBuffer
  readonly documentId: string
  readonly delivery: DocumentDelivery
  readonly scheduler: EditorWorkScheduler
  readonly retention: RetentionChanges
  readonly signal: AbortSignal
  subscribe(): void
  releaseIdleSubscription(): void
  adopt(entry: ContributionEntry<unknown>): void
}
export type BoundOperationContext = {
  readonly host: DocumentOperationHost
  readonly runtimeSessionId: string
  readonly initialRead: DocumentRead
  readonly sourceScope: DocumentContributionScope
  readonly scheduling: 'requested' | 'ordered' | 'pinned'
}

type Slot<Input, Entry> = {
  readonly input: Input
  readonly tag: readonly (string | number | boolean | null)[]
  readonly entry: Entry
  readonly owner: object | null
}
const binding = Symbol('document.operation.binding')
const leaseBinding = Symbol('document.operation.lease')

export abstract class DocumentOperation<
  Input,
  Result,
  Entry extends ContributionEntry<Result> = ContributionEntry<Result>,
> {
  private readonly slots = new WeakMap<DocumentOperationHost, Slot<Input, Entry>[]>()

  protected abstract create(context: BoundOperationContext, input: Input): Entry | null
  protected abstract matches(left: Input, right: Input): boolean
  protected abstract createRuntimeSessionId(): string
  protected get cacheInactive(): boolean {
    return false
  }

  public [binding](
    host: DocumentOperationHost,
    input: Input,
    options: DocumentOperationOptions,
    owner: object | null = null,
    capturedRead: DocumentRead | null = null,
  ): Entry | null {
    if (options.signal?.aborted || host.signal.aborted) return null
    host.subscribe()
    const tag = options.configurationTag ?? []
    const slots = this.slots.get(host) ?? []
    const found = slots.find(
      (slot) =>
        !slot.entry.signal.aborted &&
        slot.owner === owner &&
        sameTag(slot.tag, tag) &&
        this.matches(slot.input, input),
    )
    if (found) return found.entry
    const initialRead = capturedRead ?? host.delivery.current()
    if (!initialRead || host.delivery.read(initialRead.revision) !== initialRead) return null
    const sourceScope = host.delivery.createScope()
    let entry: Entry | null
    try {
      entry = this.create(
        {
          host,
          initialRead,
          sourceScope,
          runtimeSessionId: this.createRuntimeSessionId(),
          scheduling: owner ? 'pinned' : 'ordered',
        },
        input,
      )
    } catch (error) {
      sourceScope.dispose()
      host.releaseIdleSubscription()
      throw error
    }
    if (!entry) {
      sourceScope.dispose()
      host.releaseIdleSubscription()
      return null
    }
    if (host.signal.aborted || options.signal?.aborted) {
      try {
        entry.dispose()
      } finally {
        sourceScope.dispose()
        host.releaseIdleSubscription()
      }
      return null
    }
    const slot: Slot<Input, Entry> = { input, tag: [...tag], entry, owner }
    slots.push(slot)
    this.slots.set(host, slots)
    entry.signal.addEventListener('abort', () => this.retire(host, slot), { once: true })
    host.adopt(entry)
    return entry
  }

  public [leaseBinding](entry: Entry, signal?: AbortSignal): DocumentContributionLease<Result> {
    return contributionLease<Result>(entry, signal, !this.cacheInactive)
  }

  private retire(host: DocumentOperationHost, slot: Slot<Input, Entry>): void {
    const slots = this.slots.get(host)
    if (!slots) return
    const index = slots.indexOf(slot)
    if (index >= 0) slots.splice(index, 1)
    if (slots.length === 0) this.slots.delete(host)
  }
}

export function bindDocumentOperation<Input, Result, Entry extends ContributionEntry<Result>>(
  operation: DocumentOperation<Input, Result, Entry>,
  host: DocumentOperationHost,
  input: Input,
  options: DocumentOperationOptions = {},
  owner: object | null = null,
  capturedRead: DocumentRead | null = null,
): Entry | null {
  return operation[binding](host, input, options, owner, capturedRead)
}

export function retainDocumentOperation<Input, Result, Entry extends ContributionEntry<Result>>(
  operation: DocumentOperation<Input, Result, Entry>,
  host: DocumentOperationHost,
  input: Input,
  options: DocumentOperationOptions = {},
): DocumentContributionLease<Result> | null {
  const entry = operation[binding](host, input, options)
  return entry ? operation[leaseBinding](entry, options.signal) : null
}

export function leaseDocumentOperation<Input, Result, Entry extends ContributionEntry<Result>>(
  operation: DocumentOperation<Input, Result, Entry>,
  entry: Entry,
  signal?: AbortSignal,
): DocumentContributionLease<Result> {
  return operation[leaseBinding](entry, signal)
}

function contributionLease<Result>(
  entry: ContributionEntry<Result>,
  signal?: AbortSignal,
  retire = false,
): DocumentContributionLease<Result> {
  const lease = entry.lease(signal)
  if (retire)
    lease.signal.addEventListener(
      'abort',
      () => {
        if (!entry.signal.aborted && entry.leaseCount === 0) entry.dispose()
      },
      { once: true },
    )
  return {
    runtimeSessionId: entry.runtimeSessionId,
    request: () => lease.wait(() => entry.current()),
    read: () =>
      lease.signal.aborted
        ? {
            kind: 'failed',
            revision: entry.read().revision,
            error: new DOMException('Document contribution interest was released', 'AbortError'),
          }
        : entry.read(),
    dispose: lease.dispose,
  }
}

function sameTag(
  left: DocumentOperationOptions['configurationTag'],
  right: readonly (string | number | boolean | null)[],
): boolean {
  return Boolean(
    left &&
    left.length === right.length &&
    left.every((value, index) => Object.is(value, right[index])),
  )
}
