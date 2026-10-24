import { afterEach, describe, expect, it } from 'vitest'
import { TreeSitterWorkerClient } from '../src/treeSitter/workerClient'
import { RecordingWorker } from './factories/worker'
import { createTreeSource, disposeTreeSources } from './factories/source'

const clients: TreeSitterWorkerClient[] = []
afterEach(async () => {
  disposeTreeSources()
  for (const client of clients.splice(0)) await client.dispose()
})
function transport() {
  const worker = new RecordingWorker()
  const client = new TreeSitterWorkerClient({ workerFactory: () => worker })
  clients.push(client)
  return { worker, client }
}

describe('common source retirement behind the Tree endpoint', () => {
  it('rejects a late reset after the document registration is released', async () => {
    const { client, worker } = transport()
    const source = createTreeSource(client.sourceEndpoint, 'const answer = 1')
    const prepared = await source.prepare()
    const reset = worker.messages.find(
      (request) => request.payload.type === 'source' && request.payload.command.kind === 'reset',
    )!.payload
    await prepared.dispose()
    source.dispose()
    expect(worker.reader.inspect()).toMatchObject({
      documents: 0,
      reads: 0,
      pins: 0,
      sourceUnits: 0,
    })
    if (reset.type !== 'source')
      throw new TypeError('The actual source reset must have been dispatched')
    expect(worker.reader.apply(reset.command)).toMatchObject({
      kind: 'rejected',
      reason: 'detached',
    })
  })

  it('keeps the source at the current small text across forty insert/delete cycles', async () => {
    const { client, worker } = transport()
    const source = createTreeSource(client.sourceEndpoint, 'prefix suffix')
    for (let cycle = 0; cycle < 40; cycle++) {
      source.edit([
        { from: 7, to: 7, text: `${cycle.toString().padStart(8, '0')}${'x'.repeat(16376)}` },
      ])
      await (await source.prepare()).dispose()
      source.edit([{ from: 7, to: 16391, text: '' }])
      await (await source.prepare()).dispose()
    }
    expect(worker.reader.inspect()).toEqual({ documents: 1, reads: 0, pins: 0, sourceUnits: 13 })
    source.dispose()
    expect(worker.reader.inspect()).toEqual({ documents: 0, reads: 0, pins: 0, sourceUnits: 0 })
  })

  it('keeps an exact pinned old source and independent peer through head advance and retirement', async () => {
    const { client, worker } = transport()
    const source = createTreeSource(client.sourceEndpoint, 'old😀', 'one')
    const peer = createTreeSource(client.sourceEndpoint, 'peer', 'two')
    const old = await source.prepare()
    await (await peer.prepare()).dispose()
    source.edit([{ from: 0, to: 0, text: 'new' }])
    await (await source.prepare()).dispose()
    const loan = worker.reader.acquire(old.reference)!
    expect(loan.text.readRange(0, loan.text.length)).toBe('old😀')
    await old.dispose()
    loan.dispose()
    source.dispose()
    expect(worker.reader.inspect()).toEqual({ documents: 1, reads: 0, pins: 0, sourceUnits: 4 })
    peer.edit([{ from: 4, to: 4, text: '!' }])
    const latest = await peer.prepare()
    const survivor = worker.reader.acquire(latest.reference)!
    expect(survivor.text.readRange(0, survivor.text.length)).toBe('peer!')
    survivor.dispose()
    await latest.dispose()
    peer.dispose()
    expect(worker.reader.inspect()).toEqual({ documents: 0, reads: 0, pins: 0, sourceUnits: 0 })
  })
})
