import { describe, expect, it } from 'vitest'

import {
  createPieceTableSnapshot,
  deleteFromPieceTable,
  insertIntoPieceTable,
  materializePieceTableFullText,
  type PieceTableSnapshot,
} from '@singapore-editor/core/document'
import {
  readTreeSitterInputRange,
  resolveTreeSitterSourceDescriptor,
  type TreeSitterSourceCache,
} from '../src/treeSitter/source.ts'
import {
  TreeSitterSourceChunkRetention,
  type TreeSitterSourceChunkRequest,
} from '../src/treeSitter/sourceChunkRetention.ts'

const payload = (cycle: number) => `${cycle.toString().padStart(8, '0')}${'x'.repeat(16376)}`

// Build, post and resolve in order like the client and worker; responses land in any order.
class Transport {
  readonly retention = new TreeSitterSourceChunkRetention()
  readonly worker: TreeSitterSourceCache = new Map()
  readonly inFlight: TreeSitterSourceChunkRequest[] = []

  send(snapshot: PieceTableSnapshot): void {
    const source = this.retention.createDescriptor('doc', snapshot)
    const request = this.retention.createRequest('doc', source)
    const input = resolveTreeSitterSourceDescriptor(this.worker, 'doc', source)
    expect(readTreeSitterInputRange(input, 0, input.length)).toBe(
      materializePieceTableFullText(snapshot),
    )
    this.inFlight.push(request)
  }

  respond(index: number): void {
    const [request] = this.inFlight.splice(index, 1)
    this.retention.markRequestSent(request!)
  }

  workerChunks(): number {
    return this.worker.get('doc')?.size ?? 0
  }
}

describe('tree-sitter source chunk eviction', () => {
  it('keeps the worker to the chunks of the latest descriptor', () => {
    const transport = new Transport()
    let snapshot = createPieceTableSnapshot('prefix suffix')
    for (let cycle = 0; cycle < 40; cycle++) {
      snapshot = insertIntoPieceTable(snapshot, 7, payload(cycle))
      transport.send(snapshot)
      transport.respond(0)
      snapshot = deleteFromPieceTable(snapshot, 7, 16384)
      transport.send(snapshot)
      transport.respond(0)
    }
    expect(transport.workerChunks()).toBe(1)
    expect(transport.retention.inspect().sentChunks).toBe(1)
  })

  it('never names a chunk the worker dropped when responses overlap or reorder', () => {
    const transport = new Transport()
    const states: PieceTableSnapshot[] = [createPieceTableSnapshot('prefix suffix')]
    let seed = 7
    const next = () => (seed = (seed * 48271) % 2147483647) / 2147483647
    for (let step = 0; step < 300; step++) {
      const choice = next()
      const current = states.at(-1)!
      if (choice < 0.35) states.push(insertIntoPieceTable(current, 7, payload(step)))
      else if (choice < 0.6 && current.length > 13) {
        states.push(deleteFromPieceTable(current, 7, Math.min(16384, current.length - 13)))
      }
      // Revisit an older state, as undo does, so a dropped chunk is needed again.
      const target = next() < 0.2 ? states[Math.floor(next() * states.length)]! : states.at(-1)!
      transport.send(target)
      while (transport.inFlight.length > 0 && next() < 0.5) {
        transport.respond(Math.floor(next() * transport.inFlight.length))
      }
    }
  })
})
