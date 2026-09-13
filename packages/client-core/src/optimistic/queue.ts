import { createStore } from 'zustand/vanilla'

export type IntentStatus = 'acknowledged' | 'pending'
export type IntentSettlement = 'acknowledged' | 'discarded' | 'failed'

/**
 * One unconfirmed change. It exists from `submit` until the server acknowledges
 * it, the transport fails, a newer intent on the same resource supersedes it,
 * or the caller discards it. There is no other exit, which is what keeps an
 * optimistic read from outliving the truth it predicted.
 */
export type Intent<TPatch> = {
  readonly intentId: string
  readonly sequence: number
  readonly patch: TPatch
  readonly resources: readonly string[]
  readonly status: IntentStatus
  readonly enqueuedAt: number
  readonly transportSettled: boolean
  readonly settled: Promise<IntentSettlement>
}

export type FailedIntent<TPatch> = {
  readonly intentId: string
  readonly sequence: number
  readonly patch: TPatch
  readonly resources: readonly string[]
  readonly error: unknown
  /** A newer intent touched the same resource, so retrying this one would reorder writes. */
  readonly superseded: boolean
}

export type IntentQueueState<TPatch> = {
  readonly active: readonly Intent<TPatch>[]
  readonly failed: readonly FailedIntent<TPatch>[]
}

export type SubmitIntentOptions = {
  readonly intentId?: string
  readonly resources?: readonly string[]
}

export type SubmitIntentResult<TPatch> = {
  readonly intent: Intent<TPatch>
  readonly supersededIntentIds: readonly string[]
}

export type IntentQueue<TPatch> = {
  readonly getState: () => IntentQueueState<TPatch>
  /** Lets zustand's `useStore(queue, selector)` read the queue directly. */
  readonly getInitialState: () => IntentQueueState<TPatch>
  readonly subscribe: (
    listener: (state: IntentQueueState<TPatch>, previous: IntentQueueState<TPatch>) => void,
  ) => () => void
  readonly submit: (patch: TPatch, options?: SubmitIntentOptions) => SubmitIntentResult<TPatch>
  /** The server confirmed the change. Removes the intent once the transport has also settled. */
  readonly acknowledge: (intentId: string) => Intent<TPatch> | null
  /** The request finished, success or not. Removes the intent if it was already acknowledged. */
  readonly settleTransport: (intentId: string) => void
  /** Moves a pending intent to `failed`. Returns null when it was already acknowledged. */
  readonly fail: (intentId: string, error: unknown) => FailedIntent<TPatch> | null
  /** Re-enqueues a failed intent with a fresh sequence. Refuses a superseded one. */
  readonly retry: (intentId: string) => Intent<TPatch> | null
  readonly discard: (intentId: string) => boolean
  readonly discardFailed: (intentId: string) => boolean
  readonly reset: () => void
}

export type IntentQueueOptions = {
  /** How two resource keys collide. Defaults to equality. */
  readonly resourcesIntersect?: (left: string, right: string) => boolean
}

type MutableIntent<TPatch> = Intent<TPatch> & {
  readonly resolveSettlement: (settlement: IntentSettlement) => void
}

type InternalState<TPatch> = {
  readonly active: readonly MutableIntent<TPatch>[]
  readonly failed: readonly FailedIntent<TPatch>[]
  readonly nextSequence: number
}

export function createIntentQueue<TPatch>(options: IntentQueueOptions = {}): IntentQueue<TPatch> {
  const intersects = options.resourcesIntersect ?? ((left, right) => left === right)
  const store = createStore<InternalState<TPatch>>()(() => ({
    active: [],
    failed: [],
    nextSequence: 0,
  }))

  function resourcesCollide(left: readonly string[], right: readonly string[]) {
    return left.some((leftKey) => right.some((rightKey) => intersects(leftKey, rightKey)))
  }

  function activeIntent(intentId: string) {
    return store.getState().active.find((entry) => entry.intentId === intentId) ?? null
  }

  function enqueue(
    patch: TPatch,
    resources: readonly string[],
    intentId: string,
  ): MutableIntent<TPatch> {
    let resolveSettlement: (settlement: IntentSettlement) => void = () => undefined
    const settled = new Promise<IntentSettlement>((resolve) => {
      resolveSettlement = resolve
    })
    const sequence = store.getState().nextSequence + 1
    store.setState({ nextSequence: sequence })

    return {
      intentId,
      sequence,
      patch,
      resources,
      status: 'pending',
      enqueuedAt: now(),
      transportSettled: false,
      settled,
      resolveSettlement,
    }
  }

  return {
    getState: () => store.getState(),
    getInitialState: () => store.getInitialState(),
    subscribe: (listener) => store.subscribe((state, previous) => listener(state, previous)),
    submit: (patch, submitOptions = {}) => {
      const resources = submitOptions.resources ?? []
      const intent = enqueue(
        patch,
        resources,
        submitOptions.intentId ?? globalThis.crypto.randomUUID(),
      )
      const supersededIntentIds = store
        .getState()
        .failed.filter((entry) => !entry.superseded && resourcesCollide(entry.resources, resources))
        .map((entry) => entry.intentId)

      store.setState((state) => ({
        active: [...state.active, intent],
        failed: state.failed.map((entry) =>
          supersededIntentIds.includes(entry.intentId) ? { ...entry, superseded: true } : entry,
        ),
      }))

      return { intent, supersededIntentIds }
    },
    acknowledge: (intentId) => {
      const entry = activeIntent(intentId)
      if (!entry) return null
      if (entry.status === 'acknowledged') return entry

      store.setState((state) => ({
        active: state.active.flatMap((candidate) => {
          if (candidate.intentId !== intentId) return [candidate]
          if (candidate.transportSettled) return []
          return [{ ...candidate, status: 'acknowledged' as const }]
        }),
      }))
      entry.resolveSettlement('acknowledged')

      return { ...entry, status: 'acknowledged' }
    },
    settleTransport: (intentId) => {
      store.setState((state) => ({
        active: state.active.flatMap((candidate) => {
          if (candidate.intentId !== intentId) return [candidate]
          if (candidate.status === 'acknowledged') return []
          return [{ ...candidate, transportSettled: true }]
        }),
      }))
    },
    fail: (intentId, error) => {
      const entry = activeIntent(intentId)
      if (!entry) return null
      if (entry.status === 'acknowledged') return null

      const failed: FailedIntent<TPatch> = {
        intentId,
        sequence: entry.sequence,
        patch: entry.patch,
        resources: entry.resources,
        error,
        superseded: store
          .getState()
          .active.some(
            (candidate) =>
              candidate.sequence > entry.sequence &&
              resourcesCollide(candidate.resources, entry.resources),
          ),
      }
      store.setState((state) => ({
        active: state.active.filter((candidate) => candidate.intentId !== intentId),
        failed: [...state.failed, failed],
      }))
      entry.resolveSettlement('failed')

      return failed
    },
    retry: (intentId) => {
      const failed = store.getState().failed.find((entry) => entry.intentId === intentId)
      if (!failed || failed.superseded) return null

      const intent = enqueue(failed.patch, failed.resources, intentId)
      store.setState((state) => ({
        active: [...state.active, intent],
        failed: state.failed.filter((entry) => entry.intentId !== intentId),
      }))

      return intent
    },
    discard: (intentId) => {
      const entry = activeIntent(intentId)
      if (!entry) return false

      store.setState((state) => ({
        active: state.active.filter((candidate) => candidate.intentId !== intentId),
      }))
      entry.resolveSettlement('discarded')
      return true
    },
    discardFailed: (intentId) => {
      const failed = store.getState().failed
      if (!failed.some((entry) => entry.intentId === intentId)) return false

      store.setState({ failed: failed.filter((entry) => entry.intentId !== intentId) })
      return true
    },
    reset: () => {
      for (const entry of store.getState().active) entry.resolveSettlement('discarded')
      store.setState({ active: [], failed: [], nextSequence: 0 })
    },
  }
}

/** Pending intents in submission order: the only ones a projection replays. */
export function pendingIntents<TPatch>(active: readonly Intent<TPatch>[]): Intent<TPatch>[] {
  return active
    .filter((intent) => intent.status === 'pending')
    .toSorted((left, right) => left.sequence - right.sequence)
}

function now() {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}
