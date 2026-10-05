import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { inspect } from 'node:util'

type ForwardOutcome =
  | { readonly kind: 'succeeded' }
  | { readonly kind: 'failed'; readonly error: unknown }
  | { readonly kind: 'cancelled' }

type ForwardSettlement = Exclude<ForwardOutcome, { readonly kind: 'cancelled' }>

type ForwardObservation = {
  readonly requestId: number
  readonly url: string
  readonly phase: 'operation' | 'restoration' | 'shutdown'
  readonly operationInvoked: boolean
  readonly registeredAt: number
  action: {
    kind: 'fulfill' | 'abort'
    selectedAt: number
    settledAt: number | null
    error: string | null
  } | null
  skippedActions: ('fulfill' | 'abort')[]
  terminal: { kind: ForwardOutcome['kind']; at: number } | null
  settlement: {
    kind: 'succeeded' | 'failed' | 'not-started'
    at: number
    error: string | null
  } | null
}

type RecordForwardError = (observation: ForwardObservation, stage: string, error: unknown) => void

type FulfillForward = (action: () => Promise<void>) => Promise<void>

function createRetentionRouteAction(
  observation: ForwardObservation,
  abort: () => Promise<void>,
  record: RecordForwardError,
) {
  let owned: Promise<void> | null = null
  const claim = (kind: 'fulfill' | 'abort', action: () => Promise<void>) => {
    if (observation.action) {
      observation.skippedActions.push(kind)
      return Promise.resolve()
    }
    const state: NonNullable<ForwardObservation['action']> = {
      kind,
      selectedAt: Date.now(),
      settledAt: null,
      error: null,
    }
    observation.action = state
    owned = performRetentionRouteAction(state, action).catch((error: unknown) => {
      record(observation, 'route-action-' + kind, error)
      throw error
    })
    void owned.catch(() => {})
    return owned
  }
  return {
    fulfill: (action: () => Promise<void>) => claim('fulfill', action),
    abort: () => claim('abort', abort),
    join: () => owned ?? Promise.resolve(),
  }
}

async function performRetentionRouteAction(
  state: NonNullable<ForwardObservation['action']>,
  action: () => Promise<void>,
) {
  try {
    await action()
    state.settledAt = Date.now()
  } catch (error) {
    state.settledAt = Date.now()
    state.error = String(error)
    throw error
  }
}

function createRetentionForward(
  observation: ForwardObservation,
  record: RecordForwardError,
  failed: (error: unknown) => void,
) {
  let outcome: ForwardOutcome | null = null
  let resolve: (value: ForwardOutcome) => void = () => {}
  const terminal = new Promise<ForwardOutcome>((complete) => {
    resolve = complete
  })
  const select = (value: ForwardOutcome) => {
    if (outcome) return false
    outcome = value
    observation.terminal = { kind: value.kind, at: Date.now() }
    if (value.kind === 'failed') {
      record(observation, 'forward', value.error)
      failed(value.error)
    }
    resolve(value)
    return true
  }
  return { terminal, select, cancel: () => select({ kind: 'cancelled' }) }
}

async function observeRetentionForward(
  operation: () => Promise<void>,
  select: (outcome: ForwardOutcome) => void,
): Promise<ForwardSettlement> {
  try {
    await operation()
    const outcome: ForwardSettlement = { kind: 'succeeded' }
    select(outcome)
    return outcome
  } catch (error) {
    const outcome: ForwardSettlement = { kind: 'failed', error }
    select(outcome)
    return outcome
  }
}

async function completeRetentionForward(
  observation: ForwardObservation,
  terminal: Promise<ForwardOutcome>,
  actual: Promise<ForwardSettlement> | null,
  routeAction: ReturnType<typeof createRetentionRouteAction>,
  record: RecordForwardError,
) {
  const outcome = await terminal
  if (outcome.kind !== 'succeeded') {
    void routeAction.abort().catch(() => {})
  }
  if (!actual) {
    observation.settlement = { kind: 'not-started', at: Date.now(), error: null }
    await routeAction.join().catch(() => {})
    return
  }
  const settled = await actual
  observation.settlement = {
    kind: settled.kind === 'failed' ? 'failed' : 'succeeded',
    at: Date.now(),
    error: settled.kind === 'failed' ? String(settled.error) : null,
  }
  if (outcome.kind === 'cancelled' && settled.kind === 'failed')
    record(observation, 'settled-after-owned-cancellation', settled.error)
  await routeAction.join().catch(() => {})
}

export function createRetentionReloadTransport() {
  const tasks = new Set<Promise<void>>()
  const routeActions: ReturnType<typeof createRetentionRouteAction>[] = []
  const pending = new Set<() => void>()
  const requests: ForwardObservation[] = []
  const failures: { requestId: number; url: string; at: number; stage: string; error: string }[] =
    []
  let phase: ForwardObservation['phase'] = 'operation'
  let admitting = true
  let firstFailure: { error: unknown } | null = null
  let fail: (error: unknown) => void = () => {}
  const failure = new Promise<unknown>((resolve) => {
    fail = resolve
  })
  const record: RecordForwardError = (observation, stage, error) => {
    failures.push({
      requestId: observation.requestId,
      url: observation.url,
      at: Date.now(),
      stage,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  const failed = (error: unknown) => {
    if (firstFailure) return
    firstFailure = { error }
    fail(error)
  }
  return {
    failures,
    requests,
    get firstError() {
      return firstFailure?.error
    },
    get hasFailure() {
      return firstFailure !== null
    },
    get needsContextClose() {
      return requests.some(
        (request) =>
          request.action !== null &&
          (request.action.settledAt === null || request.action.error !== null),
      )
    },
    beginRestoration() {
      phase = 'restoration'
    },
    stopAdmission() {
      admitting = false
      phase = 'shutdown'
    },
    async cancelPending() {
      await Promise.resolve()
      for (const cancel of pending) cancel()
    },
    async race<T>(operation: Promise<T>): Promise<T> {
      return Promise.race([
        operation,
        failure.then((error): never => {
          throw error
        }),
      ])
    },
    run(
      url: string,
      operation: (fulfill: FulfillForward) => Promise<void>,
      abort: () => Promise<void>,
    ) {
      const observation: ForwardObservation = {
        requestId: requests.length + 1,
        url,
        phase,
        operationInvoked: admitting,
        registeredAt: Date.now(),
        action: null,
        skippedActions: [],
        terminal: null,
        settlement: null,
      }
      requests.push(observation)
      const request = createRetentionForward(observation, record, failed)
      const routeAction = createRetentionRouteAction(observation, abort, record)
      routeActions.push(routeAction)
      const cancel = () => {
        if (!request.cancel()) return
        void routeAction.abort().catch(() => {})
      }
      pending.add(cancel)
      const actual = admitting
        ? observeRetentionForward(() => operation(routeAction.fulfill), request.select)
        : null
      if (!admitting) request.cancel()
      const task = completeRetentionForward(
        observation,
        request.terminal,
        actual,
        routeAction,
        record,
      )
      tasks.add(task)
      return task.finally(() => {
        pending.delete(cancel)
        tasks.delete(task)
      })
    },
    async drain() {
      await Promise.all(tasks)
      await Promise.all(routeActions.map((action) => action.join()))
    },
  }
}

export async function archiveRetentionReloadArtifact(
  output: string,
  name: string,
  payload: unknown,
) {
  const failures: unknown[] = []
  try {
    await writeFile(join(output, name), JSON.stringify(payload))
  } catch (error) {
    failures.push(error)
    try {
      const diagnostic = inspect(
        { artifact: name, failures, payload },
        {
          depth: null,
          maxArrayLength: null,
          maxStringLength: null,
          customInspect: false,
        },
      )
      await writeFile(join(output, name + '.fallback.txt'), diagnostic)
    } catch (fallbackError) {
      failures.push(fallbackError)
    }
  }
  return failures
}

export function archiveRetentionReloadFailure(output: string, payload: unknown) {
  return archiveRetentionReloadArtifact(output, 'failed-raw.json', payload)
}

export async function settleRetentionReloadCleanup(
  actions: readonly {
    readonly stage: string
    readonly run: () => Promise<unknown>
  }[],
) {
  const outcomes: { stage: string; at: number; error: unknown }[] = []
  for (const action of actions) {
    try {
      await action.run()
      outcomes.push({ stage: action.stage, at: Date.now(), error: null })
    } catch (error) {
      outcomes.push({ stage: action.stage, at: Date.now(), error })
    }
  }
  return outcomes
}
