import { CollabFailure } from './failure'
import { Host } from './host'
import { Participant } from './participant'
import { ReferenceEngine } from './reference'
import { InMemoryTransport } from './transport'
import type { OffsetEdit } from './types'

export type SimulationOptions = {
  readonly seed: number
  readonly participants: number
  readonly edits?: number
}
export type SimulationResult = {
  readonly seed: number
  readonly text: string
  readonly hostSequence: number
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
  host.subscribe((message) => {
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
  let model = ''
  try {
    for (let step = 0; step < (options.edits ?? 32); step++) {
      const participant = participants[random(participants.length)]!
      const edit = randomEdit(participant.text(), random)
      const envelope = participant.local(edit)
      transport.submit(envelope, random(8))
      if (random(5) === 0) transport.submit(envelope, random(8))
      if (options.participants === 1)
        model =
          model.slice(0, edit.offset) + edit.text + model.slice(edit.offset + edit.deleteCount)
      if (options.participants === 1 && participant.text() !== model)
        throw new CollabFailure(`single-author-local-seed-${options.seed}-step-${step}`)
      transport.advance(random(3))
    }
    transport.quiesce()
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
    if (options.participants === 1 && expected !== model)
      throw new CollabFailure(`single-author-host-seed-${options.seed}`)
    return { seed: options.seed, text: expected, hostSequence: host.hostSequence }
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
