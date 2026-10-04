import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'

import { enqueue, promote, release, type Entry } from './queue'
import { beginRun, finishRun, stopRunConcurrency } from './runtime'
import { removeSandboxes, sandbox } from './sandbox'

const entries: readonly Entry[] = ['before', 'measurement', 'short', 'after', 'next'].map(
  (label, index) => ({
    allowedCpus: label === 'measurement' || label === 'next' ? [0] : [1],
    cwd: 'fixture',
    estimateBytes: 1,
    id: index.toString(16).padStart(12, '0'),
    jobClass: label === 'measurement' || label === 'next' ? 'bench' : 'light',
    label,
    pid: process.pid,
    quiet: label === 'measurement' || label === 'next',
    server: false,
    since: '2026-01-01T00:00:00.000Z',
    sliceRoot: 'fixture',
  }),
)

afterEach(removeSandboxes)

test('measurement-owned journals retain finished and late intervals exactly once across repeated holds', () => {
  const box = sandbox()
  const held = entries.map((entry) => promote(box.state, enqueue(box.state, entry)))
  try {
    for (const index of [0, 1, 2]) beginRun(box.state, held[index]!.entry, () => index)
    expect(finishRun(box.state, held[2]!.entry.id)).toEqual([])
    const first = finishRun(box.state, held[1]!.entry.id)
    expect(first.map((job) => job.label)).toEqual(['before', 'short'])
    expect(first[0]).toMatchObject({
      endedAt: null,
      startedAt: expect.any(String),
      allowedCpus: [1],
    })
    expect(first[1]).toMatchObject({
      endedAt: expect.any(String),
      startedAt: expect.any(String),
      class: 'light',
    })
    beginRun(box.state, held[3]!.entry, () => 3)
    beginRun(box.state, held[4]!.entry, () => 4)
    const next = finishRun(box.state, held[4]!.entry.id)
    expect(next.map((job) => job.label).sort()).toEqual(['after', 'before'])
    expect(next.some((job) => job.label === 'short')).toBe(false)
    expect(existsSync(path.join(box.state, 'measurements', held[1]!.entry.id + '.json'))).toBe(
      false,
    )
  } finally {
    for (const job of held) {
      finishRun(box.state, job.entry.id)
      release(job)
    }
  }
})

test('a refused launch leaves no overlap or active runtime and a vanished owner drops its journal', () => {
  const box = sandbox()
  const measurement = promote(box.state, enqueue(box.state, entries[1]!))
  const light = promote(box.state, enqueue(box.state, entries[2]!))
  try {
    beginRun(box.state, measurement.entry, () => true)
    const refusal = { code: 'fixture-refused' }
    expect(() =>
      beginRun(box.state, light.entry, () => {
        throw refusal
      }),
    ).toThrow()
    expect(finishRun(box.state, measurement.entry.id)).toEqual([])
    expect(existsSync(path.join(box.state, 'runs', light.entry.id + '.json'))).toBe(false)
    beginRun(box.state, measurement.entry, () => true)
    release(measurement)
    beginRun(box.state, light.entry, () => true)
    expect(existsSync(path.join(box.state, 'measurements', measurement.entry.id + '.json'))).toBe(
      false,
    )
  } finally {
    finishRun(box.state, light.entry.id)
    release(light)
  }
})

test('short intervals are journaled without a sampling tick and files do not include command values', () => {
  const box = sandbox()
  const held = entries.slice(0, 3).map((entry) => promote(box.state, enqueue(box.state, entry)))
  try {
    beginRun(box.state, held[1]!.entry, () => true)
    beginRun(box.state, held[2]!.entry, () => true)
    finishRun(box.state, held[2]!.entry.id)
    const journal = finishRun(box.state, held[1]!.entry.id)
    expect(journal).toHaveLength(1)
    expect(Object.keys(journal[0]!)).toEqual([
      'allowedCpus',
      'class',
      'cwd',
      'endedAt',
      'id',
      'label',
      'pid',
      'server',
      'sliceRoot',
      'startedAt',
    ])
  } finally {
    for (const job of held) {
      finishRun(box.state, job.entry.id)
      release(job)
    }
  }
})

test('stopping concurrency retains ownership and journal intervals until whole-slice settlement', () => {
  const box = sandbox()
  const held = entries.slice(1, 4).map((entry) => promote(box.state, enqueue(box.state, entry)))
  const measurement = held[0]!.entry
  const runtimeFile = path.join(box.state, 'runs', measurement.id + '.json')
  const journalFile = path.join(box.state, 'measurements', measurement.id + '.json')
  try {
    beginRun(box.state, measurement, () => true)
    beginRun(box.state, held[1]!.entry, () => true)
    const interval = JSON.parse(readFileSync(runtimeFile, 'utf8'))
    stopRunConcurrency(box.state, measurement.id)
    const stopped = readFileSync(runtimeFile, 'utf8')
    expect(JSON.parse(stopped)).toMatchObject({
      acceptsLight: false,
      endedAt: null,
      quiet: true,
      startedAt: interval.startedAt,
    })
    expect(existsSync(held[0]!.file)).toBe(true)
    expect(existsSync(journalFile)).toBe(true)
    stopRunConcurrency(box.state, measurement.id)
    expect(readFileSync(runtimeFile, 'utf8')).toBe(stopped)
    finishRun(box.state, held[1]!.entry.id)
    // A previously admitted job can finish preparation and spawn during retained cleanup.
    beginRun(box.state, held[2]!.entry, () => true)
    const journal = finishRun(box.state, measurement.id)
    expect(journal.map((job) => job.label)).toEqual(['short', 'after'])
    expect(journal[0]!.endedAt).toEqual(expect.any(String))
    expect(journal[1]!.endedAt).toBeNull()
    expect(journal.every((job) => !Object.hasOwn(job, 'acceptsLight'))).toBe(true)
    expect(existsSync(runtimeFile)).toBe(false)
    expect(existsSync(journalFile)).toBe(false)
  } finally {
    for (const job of held) {
      finishRun(box.state, job.entry.id)
      release(job)
    }
  }
})
