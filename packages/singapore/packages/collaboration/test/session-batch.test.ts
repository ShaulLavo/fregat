import { expect, test, vi } from 'vitest'
import { MESSAGE_LIMIT } from '../src/framing'
import { editKey, type Message } from '../src/protocol'
import type { ToyEdit } from './engine'
import { Network } from './network'

test('large submissions and confirmations split into transport-sized batches', () => {
  const network = new Network(90200, 2)
  network.stabilize()
  for (const key of network.links.keys())
    network.links.set(key, { delay: 1, jitter: 1, drop: 0, duplicate: 0, tailDelay: 0 })
  const host = network.nodes.findIndex((node) => node.session.isHost)
  const sender = network.nodes[1 - host]!
  const outbound = vi.spyOn(
    network as unknown as {
      send(from: number, peer: string, message: Message<ToyEdit>): void
    },
    'send',
  )
  const edits: ToyEdit[] = []
  for (let seq = 1; seq <= 6; seq++) {
    const edit: ToyEdit = {
      document: 'document',
      epoch: sender.session.branch.authority.epoch,
      id: { actor: sender.session.peer, seq },
      lamport: seq,
      deps: edits.length ? [edits.at(-1)!.id] : [],
      change: { text: 'é'.repeat(900_000) },
    }
    edits.push(edit)
    sender.session.submit(edit)
  }
  network.advance(30)
  const messages = outbound.mock.calls.map((call) => call[2])
  for (const type of ['SUBMIT', 'CONFIRM'] as const) {
    const batches = messages.filter((message) => message.type === type)
    expect(batches.length).toBeGreaterThan(1)
    for (const message of batches)
      expect(new TextEncoder().encode(JSON.stringify(message)).byteLength).toBeLessThan(
        MESSAGE_LIMIT,
      )
    const delivered = batches.flatMap((message) => {
      if (message.type === 'SUBMIT') return message.payload.edits.map((edit) => editKey(edit.id))
      if (message.type === 'CONFIRM')
        return message.payload.records.map((record) => editKey(record.id))
      return []
    })
    expect(new Set(delivered)).toEqual(new Set(edits.map((edit) => editKey(edit.id))))
  }
  for (const node of network.nodes) {
    expect(node.engine.checkpoint().depth).toBe(edits.length)
    expect(node.session.pending.size).toBe(0)
  }
  expect(network.nodes[host]!.engine.checkpoint()).toEqual(sender.engine.checkpoint())
})
