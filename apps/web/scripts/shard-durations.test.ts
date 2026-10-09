import fs from 'node:fs'
import path from 'node:path'
import { expect, test, vi } from 'vitest'
import { createVitest } from 'vitest/node'
import * as v from 'valibot'
import DurationSequencer from '../test/shard-sequencer'
import { mergeDurations } from './shard-durations'

test.each([
  { name: 'POSIX', root: '/repo/apps/web', paths: path.posix },
  { name: 'Windows', root: 'C:\\repo\\apps\\web', paths: path.win32 },
])('the sequencer uses producer durations with $name paths', async ({ root, paths }) => {
  const recorded = v.parse(
    v.record(v.string(), v.number()),
    JSON.parse(fs.readFileSync(new URL('../test/shard-durations.json', import.meta.url), 'utf8')),
  )
  const entries = Array.from(
    new Map(
      Object.entries(recorded)
        .sort(([, a], [, b]) => b - a)
        .map(([key, seconds]) => [seconds, key] as const),
    ),
  )
    .slice(0, 3)
    .map(([seconds, key]) => [key, seconds] as const)
  expect(entries).toHaveLength(3)
  const durations = mergeDurations([
    {
      success: true,
      testResults: entries.map(([key, seconds]) => ({
        name: paths.join(root, key),
        startTime: 0,
        endTime: seconds * 1000,
      })),
    },
  ])
  const relativePath = paths.relative
  expect(durations).toEqual(Object.fromEntries(entries))
  const ctx = await createVitest(
    { config: false, watch: false },
    { server: { middlewareMode: true } },
  )
  const relative = vi.spyOn(path, 'relative').mockImplementation(relativePath)
  try {
    ctx.config.root = root
    ctx.config.shard = { count: 2, index: 1 }
    const project = ctx.getRootProject()
    const files = Object.keys(durations).map((key) =>
      project.createSpecification(paths.join(root, key)),
    )
    const sequencer = new DurationSequencer(ctx)
    const first = await sequencer.shard(files)
    expect(first.map((file) => file.moduleId)).toEqual(
      entries.slice(0, 1).map(([key]) => paths.join(root, key)),
    )
    ctx.config.shard.index = 2
    const second = await sequencer.shard(files)
    expect(second.map((file) => file.moduleId)).toEqual(
      entries.slice(1).map(([key]) => paths.join(root, key)),
    )
    expect(new Set(first.concat(second))).toEqual(new Set(files))
  } finally {
    relative.mockRestore()
    await ctx.close()
  }
})

test('CI reports from independent checkouts share file keys and use median timings', () => {
  const reports = [1200, 8000, 1600].map((duration, index) => ({
    success: true as const,
    testResults: [
      {
        name: `/checkout-${index}/apps/web/src/slow.test.ts`,
        startTime: 100,
        endTime: 100 + duration,
      },
    ],
  }))
  expect(mergeDurations(reports)).toEqual({ 'src/slow.test.ts': 1.6 })
})

test('shard reports preserve their union and average the middle pair', () => {
  expect(
    mergeDurations([
      {
        success: true,
        testResults: [
          { name: '/ci/apps/web/src/a.test.ts', startTime: 0, endTime: 1000 },
          { name: '/ci/apps/web/src/b.test.tsx', startTime: 0, endTime: 3000 },
        ],
      },
      {
        success: true,
        testResults: [{ name: 'C:\\ci\\apps\\web\\src\\a.test.ts', startTime: 0, endTime: 2000 }],
      },
    ]),
  ).toEqual({ 'src/a.test.ts': 1.5, 'src/b.test.tsx': 3 })
})
