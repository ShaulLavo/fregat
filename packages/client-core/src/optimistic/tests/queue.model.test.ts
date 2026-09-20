import fc from 'fast-check'
import { expect, test } from 'vitest'

import {
  createIntentQueue,
  pendingIntents,
  type Intent,
  type IntentQueue,
  type IntentSettlement,
  type IntentStatus,
} from '../queue'

type Patch = { readonly label: string }

type ModelIntent = {
  readonly intentId: string
  readonly sequence: number
  readonly resources: readonly string[]
  readonly status: IntentStatus
  readonly transportSettled: boolean
}

type ModelFailed = {
  readonly intentId: string
  readonly sequence: number
  readonly resources: readonly string[]
}

type ModelWrite = { readonly sequence: number; readonly resources: readonly string[] }

type Model = {
  active: ModelIntent[]
  failed: ModelFailed[]
  /** Every submit and retry since the last reset, whatever became of it. */
  writes: ModelWrite[]
  nextSequence: number
  settlements: Map<string, IntentSettlement[]>
}

type Real = {
  readonly queue: IntentQueue<Patch>
  readonly settlements: Map<string, IntentSettlement[]>
}

// Small pools so ids recur and resources collide.
const INTENT_IDS = ['a', 'b', 'c', 'd']
const RESOURCES = ['r1', 'r2', 'r3']

function collide(left: readonly string[], right: readonly string[]) {
  return left.some((key) => right.includes(key))
}

/** Superseded means a newer write touched the same resource, whatever its fate. */
function isSuperseded(model: Model, entry: ModelFailed) {
  return model.writes.some(
    (write) => write.sequence > entry.sequence && collide(write.resources, entry.resources),
  )
}

function enqueueInModel(model: Model, intentId: string, resources: readonly string[]) {
  model.nextSequence += 1
  model.writes.push({ sequence: model.nextSequence, resources })
  model.active.push({
    intentId,
    sequence: model.nextSequence,
    resources,
    status: 'pending',
    transportSettled: false,
  })
}

function settleInModel(model: Model, intentId: string, settlement: IntentSettlement) {
  model.settlements.set(intentId, [...(model.settlements.get(intentId) ?? []), settlement])
}

function removeActive(model: Model, intentId: string) {
  model.active = model.active.filter((entry) => entry.intentId !== intentId)
}

function replaceActive(model: Model, next: ModelIntent) {
  model.active = model.active.map((entry) => (entry.intentId === next.intentId ? next : entry))
}

function trackSettlement(real: Real, intent: Intent<Patch>) {
  void intent.settled.then((settlement) => {
    real.settlements.set(intent.intentId, [
      ...(real.settlements.get(intent.intentId) ?? []),
      settlement,
    ])
  })
}

async function expectRealMatchesModel(model: Model, real: Real) {
  const state = real.queue.getState()

  expect(
    state.active.map(({ intentId, sequence, resources, status, transportSettled }) => ({
      intentId,
      sequence,
      resources,
      status,
      transportSettled,
    })),
  ).toEqual(model.active)
  expect(
    state.failed.map(({ intentId, sequence, resources, superseded }) => ({
      intentId,
      sequence,
      resources,
      superseded,
    })),
  ).toEqual(model.failed.map((entry) => ({ ...entry, superseded: isSuperseded(model, entry) })))
  expect(pendingIntents(state.active).map((intent) => intent.intentId)).toEqual(
    model.active
      .filter((entry) => entry.status === 'pending')
      .toSorted((left, right) => left.sequence - right.sequence)
      .map((entry) => entry.intentId),
  )

  // `settled` resolves on a microtask; an intent that left without resolving shows up here.
  await Promise.resolve()
  expect(real.settlements).toEqual(model.settlements)
}

type QueueCommand = fc.AsyncCommand<Model, Real>

class SubmitCommand implements QueueCommand {
  constructor(
    readonly intentId: string,
    readonly resources: readonly string[],
  ) {}

  // Every caller mints a fresh id, so a live id is never submitted twice.
  check(model: Readonly<Model>) {
    const live = [...model.active, ...model.failed]
    return !live.some((entry) => entry.intentId === this.intentId)
  }

  async run(model: Model, real: Real) {
    const newlySuperseded = model.failed
      .filter((entry) => !isSuperseded(model, entry) && collide(entry.resources, this.resources))
      .map((entry) => entry.intentId)
    enqueueInModel(model, this.intentId, this.resources)

    const result = real.queue.submit(
      { label: this.intentId },
      { intentId: this.intentId, resources: this.resources },
    )
    trackSettlement(real, result.intent)

    expect(result.supersededIntentIds).toEqual(newlySuperseded)
    await expectRealMatchesModel(model, real)
  }

  toString() {
    return `submit(${this.intentId}, [${this.resources.join(',')}])`
  }
}

class AcknowledgeCommand implements QueueCommand {
  constructor(readonly intentId: string) {}

  check() {
    return true
  }

  async run(model: Model, real: Real) {
    const entry = model.active.find((candidate) => candidate.intentId === this.intentId)
    const acknowledged = real.queue.acknowledge(this.intentId)

    expect(acknowledged?.status ?? null).toBe(entry ? 'acknowledged' : null)
    if (entry?.status === 'pending') this.acknowledgeInModel(model, entry)
    await expectRealMatchesModel(model, real)
  }

  acknowledgeInModel(model: Model, entry: ModelIntent) {
    settleInModel(model, entry.intentId, 'acknowledged')
    if (entry.transportSettled) return removeActive(model, entry.intentId)
    replaceActive(model, { ...entry, status: 'acknowledged' })
  }

  toString() {
    return `acknowledge(${this.intentId})`
  }
}

class SettleTransportCommand implements QueueCommand {
  constructor(readonly intentId: string) {}

  check() {
    return true
  }

  async run(model: Model, real: Real) {
    const entry = model.active.find((candidate) => candidate.intentId === this.intentId)
    real.queue.settleTransport(this.intentId)

    if (entry?.status === 'acknowledged') removeActive(model, entry.intentId)
    if (entry?.status === 'pending') replaceActive(model, { ...entry, transportSettled: true })
    await expectRealMatchesModel(model, real)
  }

  toString() {
    return `settleTransport(${this.intentId})`
  }
}

class FailCommand implements QueueCommand {
  constructor(readonly intentId: string) {}

  check() {
    return true
  }

  async run(model: Model, real: Real) {
    const entry = model.active.find((candidate) => candidate.intentId === this.intentId)
    const failed = real.queue.fail(this.intentId, 'boom')

    if (entry?.status !== 'pending') {
      expect(failed).toBeNull()
      return expectRealMatchesModel(model, real)
    }

    removeActive(model, entry.intentId)
    model.failed.push({
      intentId: entry.intentId,
      sequence: entry.sequence,
      resources: entry.resources,
    })
    settleInModel(model, entry.intentId, 'failed')
    expect(failed?.superseded).toBe(isSuperseded(model, entry))
    await expectRealMatchesModel(model, real)
  }

  toString() {
    return `fail(${this.intentId})`
  }
}

class RetryCommand implements QueueCommand {
  constructor(readonly intentId: string) {}

  check() {
    return true
  }

  async run(model: Model, real: Real) {
    const entry = model.failed.find((candidate) => candidate.intentId === this.intentId)
    const retryable = entry !== undefined && !isSuperseded(model, entry)
    const retried = real.queue.retry(this.intentId)

    // The property the `superseded` flag exists for: a retry never reorders writes.
    expect(retried !== null).toBe(retryable)
    if (retried) trackSettlement(real, retried)
    if (entry && retryable) this.retryInModel(model, entry)
    await expectRealMatchesModel(model, real)
  }

  retryInModel(model: Model, entry: ModelFailed) {
    model.failed = model.failed.filter((candidate) => candidate.intentId !== entry.intentId)
    enqueueInModel(model, entry.intentId, entry.resources)
  }

  toString() {
    return `retry(${this.intentId})`
  }
}

class DiscardCommand implements QueueCommand {
  constructor(readonly intentId: string) {}

  check() {
    return true
  }

  async run(model: Model, real: Real) {
    const entry = model.active.find((candidate) => candidate.intentId === this.intentId)

    expect(real.queue.discard(this.intentId)).toBe(entry !== undefined)
    // An acknowledged intent already settled; discarding it must not settle it again.
    if (entry?.status === 'pending') settleInModel(model, entry.intentId, 'discarded')
    if (entry) removeActive(model, entry.intentId)
    await expectRealMatchesModel(model, real)
  }

  toString() {
    return `discard(${this.intentId})`
  }
}

class DiscardFailedCommand implements QueueCommand {
  constructor(readonly intentId: string) {}

  check() {
    return true
  }

  async run(model: Model, real: Real) {
    const known = model.failed.some((entry) => entry.intentId === this.intentId)

    expect(real.queue.discardFailed(this.intentId)).toBe(known)
    model.failed = model.failed.filter((entry) => entry.intentId !== this.intentId)
    await expectRealMatchesModel(model, real)
  }

  toString() {
    return `discardFailed(${this.intentId})`
  }
}

class ResetCommand implements QueueCommand {
  check() {
    return true
  }

  async run(model: Model, real: Real) {
    real.queue.reset()

    for (const entry of model.active) {
      if (entry.status !== 'pending') continue
      settleInModel(model, entry.intentId, 'discarded')
    }
    model.active = []
    model.failed = []
    model.writes = []
    model.nextSequence = 0
    await expectRealMatchesModel(model, real)
  }

  toString() {
    return 'reset()'
  }
}

const intentId = fc.constantFrom(...INTENT_IDS)
const resources = fc.uniqueArray(fc.constantFrom(...RESOURCES), { maxLength: 2 })

const queueCommands = fc.commands(
  [
    fc.tuple(intentId, resources).map(([id, keys]) => new SubmitCommand(id, keys)),
    intentId.map((id) => new AcknowledgeCommand(id)),
    intentId.map((id) => new SettleTransportCommand(id)),
    intentId.map((id) => new FailCommand(id)),
    intentId.map((id) => new RetryCommand(id)),
    intentId.map((id) => new DiscardCommand(id)),
    intentId.map((id) => new DiscardFailedCommand(id)),
    fc.constant(new ResetCommand()),
  ],
  // The default size yields ~5 commands a run, too short to reach a multi-step interleaving.
  { maxCommands: 40, size: 'max' },
)

test('any interleaving of queue operations matches the model', async () => {
  await fc.assert(
    fc.asyncProperty(queueCommands, async (commands) => {
      const setup = () => ({
        model: {
          active: [],
          failed: [],
          writes: [],
          nextSequence: 0,
          settlements: new Map(),
        } satisfies Model,
        real: { queue: createIntentQueue<Patch>(), settlements: new Map() } satisfies Real,
      })
      await fc.asyncModelRun(setup, commands)
    }),
    { numRuns: 500 },
  )
})
