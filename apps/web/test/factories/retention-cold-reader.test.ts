import { test, expect } from '../fixtures'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createColdReaderCounters,
  coldReaderSummary,
  measureColdReader,
} from './retention-cold-reader'
import {
  beginColdProfile,
  createColdReaderObservation,
  markColdProfile,
  publishColdProfile,
  readColdWire,
} from './retention-cold-profile'

test('synchronous receiver observation preserves exact values, promises, getters and falsy thrown identities', async () => {
  const counters = createColdReaderCounters(),
    input = Buffer.from('actual input')
  let reads = 0
  const value = Object.defineProperty({}, 'then', {
    get() {
      reads++
      throw 0
    },
  })
  expect(measureColdReader(counters, null, input, () => value)).toBe(value)
  expect(reads).toBe(0)
  const promise = Promise.resolve(17)
  expect(measureColdReader(counters, null, input, () => promise)).toBe(promise)
  expect(await promise).toBe(17)
  for (const value of [false, 0, null, undefined]) {
    expect(measureColdReader(counters, null, input, () => value)).toBe(value)
    let threw = false
    try {
      measureColdReader(counters, null, input, () => {
        throw value
      })
    } catch (actual) {
      threw = true
      expect(actual).toBe(value)
    }
    expect(threw).toBe(true)
  }
  const refused = Buffer.from('metadata getter refusal')
  Object.defineProperty(refused, 'byteLength', {
    get() {
      throw false
    },
  })
  expect(measureColdReader(counters, null, refused, () => 0)).toBe(0)
  expect(coldReaderSummary(counters).bytes).toBeNull()
  expect(counters.byteMissing).toBe(1)
  expect(counters.throws).toBe(4)
})

test('external thread API absence, refusal and counter drift stay null with fixed reasons', () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'threadCpuUsage')
  const counters = createColdReaderCounters(),
    input = Buffer.from('cpu control')
  try {
    Object.defineProperty(process, 'threadCpuUsage', { configurable: true, value: undefined })
    expect(measureColdReader(counters, null, input, () => 0)).toBe(0)
    expect(coldReaderSummary(counters).cpuReason).toBe('unsupported')
    Object.defineProperty(process, 'threadCpuUsage', {
      configurable: true,
      get() {
        throw null
      },
    })
    expect(measureColdReader(counters, null, input, () => false)).toBe(false)
    let calls = 0
    Object.defineProperty(process, 'threadCpuUsage', {
      configurable: true,
      value: () => ({ user: ++calls === 1 ? 10 : 5, system: 0 }),
    })
    expect(measureColdReader(counters, null, input, () => 17)).toBe(17)
    const result = coldReaderSummary(counters)
    expect(result.threadUserUs).toBeNull()
    expect(result.threadSystemUs).toBeNull()
    expect(result.cpuMissing).toEqual({ unsupported: 1, 'observer-refused': 1, 'counter-drift': 1 })
    expect(result.cpuReason).toBe('incomplete')
  } finally {
    if (descriptor) Object.defineProperty(process, 'threadCpuUsage', descriptor)
    else Reflect.deleteProperty(process, 'threadCpuUsage')
  }
})

test('real Buffer reads have independent helper lifetime and first-case aggregates frozen at the existing cleanup mark', async () => {
  globalThis.__retentionColdCost = undefined
  const output = await mkdtemp(join(tmpdir(), 'retention-reader-profile-'))
  try {
    const observe = createColdReaderObservation(true),
      wire = readColdWire(true)
    const before = Buffer.from('before case\n'),
      during = Buffer.from('in case\n'),
      after = Buffer.from('after case\n')
    observe('coldWire', before, () => wire(before))
    beginColdProfile(true, { syntax: 'plain', font: 'normal', saved: 'absent' }, output)
    markColdProfile('start')
    observe('coldWire', during, () => wire(during))
    const preserved: string[] = []
    observe('capture', during, () => preserved.push(during.toString()))
    markColdProfile('baseline-ready')
    markColdProfile('cleanup')
    observe('coldWire', after, () => wire(after))
    wire.finish()
    await publishColdProfile()
    const packet = JSON.parse(await readFile(join(output, 'cold-cost.json'), 'utf8'))
    expect(packet.readers.firstCaseState).toBe('closed')
    expect(packet.readers.firstCase.coldWire.chunks).toBe(1)
    expect(packet.readers.firstCase.coldWire.bytes).toBe(during.length)
    expect(packet.readers.suite.coldWire.chunks).toBe(3)
    expect(packet.readers.suite.coldWire.bytes).toBe(before.length + during.length + after.length)
    expect(packet.phases[0].readers.firstCase.coldWire.chunks).toBe(0)
    expect(packet.phases[1].readers.firstCase.coldWire.chunks).toBe(1)
    expect(preserved).toEqual([during.toString()])
    expect(Buffer.byteLength(JSON.stringify(packet))).toBeLessThan(65536)
  } finally {
    globalThis.__retentionColdCost = undefined
    await rm(output, { recursive: true, force: true })
  }
})

test('cancelled and cleanup close first admission idempotently even after the phase snapshot cap', async () => {
  const output = await mkdtemp(join(tmpdir(), 'retention-reader-terminal-'))
  try {
    for (const capped of [false, true]) {
      globalThis.__retentionColdCost = undefined
      const observe = createColdReaderObservation(true),
        input = Buffer.from('terminal boundary')
      beginColdProfile(true, { syntax: 'plain', font: 'normal', saved: 'absent' }, output)
      markColdProfile('start')
      observe('coldWire', input, () => 17)
      if (capped) for (let i = 1; i < 9; i++) markColdProfile('setup')
      markColdProfile('cancelled')
      observe('coldWire', input, () => 0)
      markColdProfile('cleanup')
      markColdProfile('cleanup')
      markColdProfile('cancelled')
      observe('coldWire', input, () => false)
      await publishColdProfile()
      const packet = JSON.parse(await readFile(join(output, 'cold-cost.json'), 'utf8'))
      expect(packet.readers.firstCaseState).toBe('closed')
      expect(packet.readers.firstCase.coldWire.chunks).toBe(1)
      expect(packet.readers.firstCase.coldWire.bytes).toBe(input.length)
      expect(packet.readers.suite.coldWire.chunks).toBe(3)
      expect(packet.phases.length).toBeLessThanOrEqual(9)
      if (capped) expect(packet.phases).toHaveLength(9)
    }
  } finally {
    globalThis.__retentionColdCost = undefined
    await rm(output, { recursive: true, force: true })
  }
})

test('repeated and late registrations retain the admitted counter owner and old closures stay reported', async () => {
  globalThis.__retentionColdCost = undefined
  const output = await mkdtemp(join(tmpdir(), 'retention-reader-owner-'))
  try {
    const input = Buffer.from('owned reader control'),
      before = createColdReaderObservation(true)
    before('coldWire', input, () => 1)
    const startup = createColdReaderObservation(true)
    beginColdProfile(true, { syntax: 'plain', font: 'normal', saved: 'absent' }, output)
    markColdProfile('start')
    before('coldWire', input, () => 2)
    const during = createColdReaderObservation(true)
    before('coldWire', input, () => 3)
    during('coldWire', input, () => 4)
    markColdProfile('cleanup')
    const late = createColdReaderObservation(true)
    startup('coldWire', input, () => 5)
    late('coldWire', input, () => 6)
    await publishColdProfile()
    const packet = JSON.parse(await readFile(join(output, 'cold-cost.json'), 'utf8'))
    expect(packet.readerObservationReason).toBeNull()
    expect(packet.readers.firstCase.coldWire.chunks).toBe(3)
    expect(packet.readers.firstCase.coldWire.bytes).toBe(input.length * 3)
    expect(packet.readers.suite.coldWire.chunks).toBe(6)
    expect(packet.readers.suite.coldWire.bytes).toBe(input.length * 6)
    const owner = globalThis.__retentionColdCost?.readers
    const publishedChunks = owner?.suite.coldWire.chunks
    expect(before('coldWire', input, () => 0)).toBe(0)
    expect(owner?.suite.coldWire.chunks).toBe(publishedChunks)
    globalThis.__retentionColdCost = undefined
    expect(before('coldWire', input, () => false)).toBe(false)
    expect(owner?.suite.coldWire.chunks).toBe(publishedChunks)
  } finally {
    globalThis.__retentionColdCost = undefined
    await rm(output, { recursive: true, force: true })
  }
})

test('terminal marking retains a callback admitted before a synchronous primary throw', async () => {
  globalThis.__retentionColdCost = undefined
  const output = await mkdtemp(join(tmpdir(), 'retention-reader-primary-'))
  try {
    const observe = createColdReaderObservation(true),
      input = Buffer.from('admitted primary')
    beginColdProfile(true, { syntax: 'plain', font: 'normal', saved: 'absent' }, output)
    let threw = false
    try {
      observe('capture', input, () => {
        markColdProfile('cancelled')
        throw null
      })
    } catch (actual) {
      threw = true
      expect(actual).toBeNull()
    }
    expect(threw).toBe(true)
    observe('capture', input, () => 0)
    await publishColdProfile()
    const packet = JSON.parse(await readFile(join(output, 'cold-cost.json'), 'utf8'))
    expect(packet.readers.firstCase.capture.chunks).toBe(1)
    expect(packet.readers.firstCase.capture.throws).toBe(1)
    expect(packet.readers.suite.capture.chunks).toBe(2)
  } finally {
    globalThis.__retentionColdCost = undefined
    await rm(output, { recursive: true, force: true })
  }
})
