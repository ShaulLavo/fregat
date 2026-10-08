import { Host, Participant } from '../src/index'
import type { Envelope, HostMessage, OffsetEdit } from '../src/index'
import { createEngine } from './engine-fixture'

export function replica(actor: string) {
  const engine = createEngine()
  const participant = new Participant({ actor, document: 'test', epoch: '1', engine })
  const edits: Envelope[] = []
  return {
    engine,
    participant,
    edits,
    insert(offset: number, text: string) {
      return local({ offset, deleteCount: 0, text })
    },
    remove(offset: number, deleteCount: number) {
      return local({ offset, deleteCount, text: '' })
    },
    replace(offset: number, deleteCount: number, text: string) {
      return local({ offset, deleteCount, text })
    },
  }
  function local(edit: OffsetEdit) {
    const envelope = participant.local(edit)
    edits.push(envelope)
    return envelope
  }
}

export function authority(options: { unknownDeps?: 'defer' | 'reject' } = {}) {
  const engine = createEngine()
  const host = new Host({ document: 'test', epoch: '1', engine, ...options })
  const messages: HostMessage[] = []
  host.subscribe((message) => messages.push(message))
  return { host, engine, messages }
}

export function accept(participant: Participant<unknown>, edits: readonly Envelope[]) {
  participant.receive(
    edits.map((envelope, index) => ({
      document: 'test',
      epoch: '1',
      sequence: index + 1,
      status: 'accepted',
      envelope,
    })),
  )
}
