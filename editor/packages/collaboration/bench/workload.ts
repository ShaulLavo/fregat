import { TextbufferEngine } from '@singapore-editor/collab'
import type { Envelope } from '@singapore-editor/collab'
import { CharIdAllocator, createPieceTableSnapshot } from '@singapore-editor/textbuffer'

export const lines = 100_000
const line = 'export const value = 1234567890;\n'
const initial = createPieceTableSnapshot(line.repeat(lines), {
  normalized: true,
  charIds: { bunch: 'initial', counter: 0 },
})
export const characters = initial.length

export function workload(authors: number, retained: number) {
  const engine = new TextbufferEngine(initial)
  const prefix: Envelope[] = []
  const allocator = new CharIdAllocator('history')
  for (let seq = 1; seq <= (retained === 100 ? 0 : retained); seq++) {
    const envelope = engine.author(
      { offset: 0, deleteCount: 0, text: 'h' },
      {
        document: 'review',
        epoch: '1',
        id: { actor: 'history', seq },
        lamport: seq,
        deps: seq > 1 ? [prefix.at(-1)!.id] : [],
        allocate: (left, count) => allocator.generateAfter(left, count),
      },
    )
    engine.apply(envelope)
    prefix.push(envelope)
  }
  const base = engine.snapshot()
  const batch: Envelope[] = []
  for (let index = 0; index < 100; index++) {
    const author = new TextbufferEngine()
    author.restore(base)
    const ids = new CharIdAllocator(`edit-${index}`)
    batch.push(
      author.author(
        {
          offset: prefix.length + Math.floor((lines * (index + 1)) / 101) * line.length + 21,
          deleteCount: 1,
          text: '9',
        },
        {
          document: 'review',
          epoch: '1',
          id: { actor: `author-${index % authors}`, seq: Math.floor(index / authors) + 1 },
          lamport: prefix.length + 1,
          deps: prefix.length ? [prefix.at(-1)!.id] : [],
          allocate: (left, count) => ids.generateAfter(left, count),
        },
      ),
    )
  }
  for (const edit of batch) engine.apply(edit)
  return { prefix, batch, confirmed: engine.snapshot() }
}
