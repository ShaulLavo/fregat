import { CollabFailure } from './failure'
import { Host } from './host'
import type { HostMessage } from './host'
import { Participant } from './participant'
import { ReferenceEngine } from './reference'
import { InMemoryTransport } from './transport'
import { VisibilityModel } from './visibility-model'
import { editKey } from './types'
import type { OffsetEdit } from './types'

export type SimulationOptions = {
  readonly seed: number
  readonly participants: number
  readonly edits?: number
  readonly undoRedo?: boolean
}
export type SimulationResult = {
  readonly seed: number
  readonly text: string
  readonly hostSequence: number
  readonly undoCommands: number
  readonly redoCommands: number
}

export function simulate(options: SimulationOptions): SimulationResult {
  if (
    !Number.isSafeInteger(options.participants) ||
    options.participants < 1 ||
    !Number.isSafeInteger(options.seed) ||
    options.seed < 0
  )
    throw new CollabFailure('invalid-simulation')
  const random = seededRandom(options.seed)
  const hostEngine = new ReferenceEngine()
  const host = new Host({ document: 'simulation', epoch: '1', engine: hostEngine })
  const log: HostMessage[] = []
  const hostModel = new VisibilityModel()
  host.subscribe((message) => {
    log.push(message)
    if (message.status === 'accepted') hostModel.apply(message.envelope)
    if (message.status === 'rejected')
      throw new CollabFailure(`rejection-seed-${options.seed}-${message.reason}`)
  })
  const engines = Array.from({ length: options.participants }, () => new ReferenceEngine())
  const participants = engines.map(
    (engine, index) =>
      new Participant({
        actor: `actor${index}`,
        document: 'simulation',
        epoch: '1',
        engine,
      }),
  )
  const transport = new InMemoryTransport(host, participants, () => random(8))
  const model = options.participants === 1 ? new StringHistory() : null
  const bases = participants.map(() => new VisibilityModel())
  const sequences = participants.map(() => 0)
  const checkParticipant = (index: number, step: number) => {
    const state = participants[index]!.state()
    const base = bases[index]!
    for (let sequence = sequences[index]!; sequence < state.hostSequence; sequence++) {
      const message = log[sequence]!
      if (message.status === 'accepted') base.apply(message.envelope)
    }
    sequences[index] = state.hostSequence
    const projection = base.fork()
    const blocked = new Set(state.blocked.map(editKey))
    for (const envelope of state.pending) {
      if (!blocked.has(editKey(envelope.id))) projection.apply(envelope)
    }
    projection.check(engines[index]!, `seed-${options.seed}-step-${step}-actor-${index}`)
  }
  const check = (step: number) => {
    hostModel.check(hostEngine, `seed-${options.seed}-step-${step}-host`)
    for (let index = 0; index < participants.length; index++) checkParticipant(index, step)
  }
  let undoCommands = 0
  let redoCommands = 0
  try {
    for (let step = 0; step < (options.edits ?? 32); step++) {
      const participant = participants[random(participants.length)]!
      const action = options.undoRedo ? random(5) : 2
      let envelope = action === 0 ? participant.undoManager.undo() : null
      if (envelope) {
        undoCommands++
        model?.undo()
      }
      if (action === 1) envelope = participant.undoManager.redo()
      if (envelope && action === 1) {
        redoCommands++
        model?.redo()
      }
      if (!envelope) {
        const edit = randomEdit(participant.text(), random)
        envelope = participant.local(edit, { boundary: true })
        model?.edit(edit)
      }
      transport.submit(participant, envelope, random(8))
      if (random(5) === 0) transport.submit(participant, envelope, random(8))
      if (model && participant.text() !== model.text)
        throw new CollabFailure(`single-author-local-seed-${options.seed}-step-${step}`)
      check(step)
      transport.advance(random(3))
      check(step)
    }
    transport.quiesce()
    check(options.edits ?? 32)
    const expected = host.text()
    for (const participant of participants) {
      const state = participant.state()
      if (
        state.text !== expected ||
        state.pending.length ||
        state.blocked.length ||
        state.hostSequence !== host.hostSequence
      ) {
        throw new CollabFailure(`convergence-seed-${options.seed}`)
      }
    }
    const identity = JSON.stringify(hostEngine.snapshot())
    if (engines.some((engine) => JSON.stringify(engine.snapshot()) !== identity))
      throw new CollabFailure(`identity-seed-${options.seed}`)
    if (model && expected !== model.text)
      throw new CollabFailure(`single-author-host-seed-${options.seed}`)
    return {
      seed: options.seed,
      text: expected,
      hostSequence: host.hostSequence,
      undoCommands,
      redoCommands,
    }
  } finally {
    transport.close()
  }
}

function seededRandom(seed: number): (limit: number) => number {
  let state = seed >>> 0
  return (limit) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return Math.floor((state / 0x100000000) * limit)
  }
}

function randomEdit(text: string, random: (limit: number) => number): OffsetEdit {
  const boundaries = [0]
  for (const character of text) boundaries.push(boundaries.at(-1)! + character.length)
  // Offset zero exercises consecutive backward typing independently of forward spans.
  const start = random(4) === 0 ? 0 : random(boundaries.length)
  const offset = boundaries[start]!
  const deleting = start < boundaries.length - 1 && random(3) === 0
  const end = deleting ? start + 1 + random(Math.min(3, boundaries.length - start - 1)) : start
  const alphabet = ['a', 'b', 'c', ' ', 'xy', '😀']
  const inserted = deleting && random(2) === 0 ? '' : alphabet[random(alphabet.length)]!
  return { offset, deleteCount: boundaries[end]! - offset, text: inserted }
}

class StringHistory {
  text = ''
  private undos: { before: string; after: string }[] = []
  private redos: { before: string; after: string }[] = []

  edit(edit: OffsetEdit): void {
    const before = this.text
    this.text =
      before.slice(0, edit.offset) + edit.text + before.slice(edit.offset + edit.deleteCount)
    this.undos.push({ before, after: this.text })
    this.redos = []
  }

  undo(): void {
    const transaction = this.undos.pop()!
    this.redos.push(transaction)
    this.text = transaction.before
  }

  redo(): void {
    const transaction = this.redos.pop()!
    this.undos.push(transaction)
    this.text = transaction.after
  }
}
