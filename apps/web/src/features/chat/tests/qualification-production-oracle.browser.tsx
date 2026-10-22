import { createMarkdownSession } from '@workspace/markdown/utils/session'
import { expect, test } from '../../../../test/fixtures'
import { createProductionMarkdownProbe } from '../../../../test/factories/markdown-production'
import type {
  ProductionMarkdownFrame,
  ProductionOracleSink,
} from '../../../../test/factories/markdown-production-types'

type Record = Parameters<ProductionOracleSink>[0]
function deterministic(frame: ProductionMarkdownFrame) {
  const { scheduled, received, committed, painted, parserWallMs, ...values } = frame
  expect([scheduled, received, committed, painted, parserWallMs].every(Number.isFinite)).toBe(true)
  return values
}
function mountProbe() {
  const host = document.createElement('main')
  document.body.append(host)
  const probe = createProductionMarkdownProbe({ factory: createMarkdownSession, host })
  return {
    host,
    probe,
    dispose: async () => {
      await probe.dispose()
      host.remove()
    },
  }
}
for (const streaming of [true, false]) {
  test(`streamed independent oracle matches bounded run and fresh completion, streamed=${streaming}`, async ({
    onTestFinished,
  }) => {
    const old = mountProbe()
    const streamed = mountProbe()
    onTestFinished(async () => {
      await old.dispose()
      await streamed.dispose()
    })
    const source = 'Hello **world**.\n\n[link](https://example.test/docs)'
    const chunks = streaming ? ['Hello ', 'Hello **world**.', source] : []
    const expected = await old.probe.run(source, chunks)
    const fresh = await old.probe.run(source, [])
    const records: Record[] = []
    await streamed.probe.streamOracle(source, chunks, async (record) => {
      records.push(record)
    })
    expect(records.map((record) => record.kind)).toEqual(
      expected.frames.map(() => 'frame').concat(['final', 'fresh']),
    )
    expect(
      records
        .filter((record) => record.kind === 'frame')
        .map((record) => deterministic(record.frame)),
    ).toEqual(expected.frames.map(deterministic))
    expect(deterministic(records[expected.frames.length].frame)).toEqual(
      deterministic(expected.final),
    )
    expect(deterministic(records[expected.frames.length + 1].frame)).toEqual(
      deterministic(fresh.final),
    )
    expect(streamed.host.textContent).toEqual(old.host.textContent)
  })
}

test('oracle backpressure pauses replay and stays outside paced and burst timing spans', async ({
  onTestFinished,
}) => {
  const mounted = mountProbe()
  const gate = Promise.withResolvers<void>()
  let running: Promise<void> | null = null
  onTestFinished(async () => {
    gate.resolve()
    await running
    await mounted.dispose()
  })
  const chunks = Array.from({ length: 33 }, (_, index) => 'x'.repeat(index + 1))
  const source = chunks[chunks.length - 1]
  const records: Record[] = []
  const completedBindings: number[] = []
  running = mounted.probe.streamOracle(source, chunks, async (record) => {
    records.push(record)
    if (records.length === 1) await gate.promise
    completedBindings.push(performance.now())
  })
  await expect.poll(() => records.length).toBe(1)
  expect(mounted.host.textContent).toBe('x')
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(records).toHaveLength(1)
  gate.resolve()
  await running
  const expected = records
    .filter((record) => record.kind === 'frame')
    .map((record) => record.frame.paintedOutput)
  const bindings = records.length
  for (const arrival of ['paced', 'burst-coalesced'] as const) {
    const receipt = await mounted.probe.time(source, chunks, {
      arrival,
      arrivalOffsetsMs: chunks.map((_, index) => index * 2),
      expected,
    })
    expect(receipt.processed).toHaveLength(34)
    expect(receipt.processed.map((tick) => tick.inputUtf16Units)).toEqual(
      chunks.map((text) => text.length).concat([source.length]),
    )
    expect(receipt.frames).toHaveLength(arrival === 'paced' ? 34 : 3)
    expect(receipt.frames.map((frame) => frame.revision)).toEqual(
      receipt.processed
        .filter((_, index) => arrival === 'paced' || (index + 1) % 32 === 0 || index >= 32)
        .map((tick) => tick.revision),
    )
    expect(receipt.processed.map((tick) => tick.scheduled - receipt.started).slice(0, -1)).toEqual(
      chunks.map((_, index) => index * 2),
    )
    expect(completedBindings.every((ended) => ended <= receipt.started)).toBe(true)
    expect(records).toHaveLength(bindings)
    expect(receipt.ended).toBeGreaterThanOrEqual(receipt.fullyReady)
  }
  await mounted.dispose()
  await expect(mounted.probe.streamOracle(source, chunks, async () => {})).rejects.toThrow(
    'disposed',
  )
})

test('oracle sink failure stops replay and the actual probe disposes its mounted renderer', async ({
  onTestFinished,
}) => {
  const mounted = mountProbe()
  onTestFinished(mounted.dispose)
  let observed = 0
  await expect(
    mounted.probe.streamOracle('AB', ['A', 'AB'], async () => {
      observed++
      throw new Error('sink failed')
    }),
  ).rejects.toThrow('sink failed')
  expect(observed).toBe(1)
  expect(mounted.host.textContent).toBe('A')
  await mounted.probe.dispose()
  expect(mounted.host.textContent).toBe('')
  await expect(mounted.probe.streamOracle('AB', [], async () => {})).rejects.toThrow('disposed')
})

test('repeated input reports one superseded revision even when its output digest matches', async ({
  onTestFinished,
}) => {
  const mounted = mountProbe()
  onTestFinished(mounted.dispose)
  const independent = await mounted.probe.run('A', ['A', 'A'])
  const samples: import('../../../../test/factories/markdown-production-types').ProductionMismatchSample[] =
    []
  const receipt = await mounted.probe.time('A', ['A', 'A'], {
    arrival: 'paced',
    arrivalOffsetsMs: [0, 0],
    expected: independent.frames.map((frame) => frame.paintedOutput),
    onMismatch: async (sample) => {
      samples.push(sample)
    },
  })
  expect(samples).toHaveLength(1)
  expect(samples[0].expectedIndex).toBe(0)
  expect(samples[0].actual.observedRevision).not.toBe(samples[0].actual.revision)
  expect(samples[0].actual.paintedOutput.digest).toBe(samples[0].expected.digest)
  expect(samples[0].actual.live).toBe(true)
  expect(receipt.frames.some((frame) => frame.observedRevision !== frame.revision)).toBe(true)
})
