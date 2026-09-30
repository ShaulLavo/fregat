import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { createTraceLocation, summarizeLayoutTrace } from '../input-layout-summary.mjs'

const window = { startMicros: 100, endMicros: 1000 }
const frame = { functionName: 'measure', url: 'editor.js', lineNumber: 4, columnNumber: 8 }

it('counts each layout once and preserves layouts without a direct stack', async () => {
  const result = await summarizeLayoutTrace(
    [
      layout(99, 9000, frame),
      layout(100, 100, frame),
      layout(300, 200, frame),
      { ...layout(600, 50), args: { data: { stackTrace: [frame] } } },
      layout(1000, 9000, frame),
      {
        name: 'LayoutInvalidationTracking',
        ph: 'I',
        ts: 500,
        args: { data: { stackTrace: [frame] } },
      },
    ],
    window,
  )
  expect(result.count).toBe(3)
  expect(result.durationMs).toBeCloseTo(0.35)
  expect(result.unattributedCount).toBe(1)
  expect(result.callsites).toEqual([
    { callsite: 'measure editor.js:4:8', count: 2, durationMs: 0.30000000000000004 },
    { callsite: '(unattributed)', count: 1, durationMs: 0.05 },
  ])
})

it('keeps different locations inside one function separate', async () => {
  const result = await summarizeLayoutTrace(
    [layout(200, 50, frame), layout(300, 50, { ...frame, columnNumber: 20 })],
    window,
  )
  expect(result.callsites.map((entry) => entry.callsite)).toEqual([
    'measure editor.js:4:8',
    'measure editor.js:4:20',
  ])
})

it.each([
  { ...window, startMicros: NaN },
  { ...window, endMicros: Infinity },
  { startMicros: 100, endMicros: 100 },
])('rejects invalid measurement windows: %j', async (invalid) => {
  await expect(summarizeLayoutTrace([], invalid)).rejects.toThrow('measurement window')
})

it.each([
  { ...layout(200, 20), ph: 'B' },
  layout(200, -1),
  layout(200, NaN),
  { ...layout(200, 20), ts: NaN },
])('rejects incomplete or invalid layout events: %j', async (event) => {
  await expect(summarizeLayoutTrace([event], window)).rejects.toThrow('Chromium Layout events')
})

it('resolves one-based timeline stack positions through the saved build map', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'editor-layout-summary-test-'))
  try {
    await mkdir(resolve(directory, 'assets'))
    await writeFile(
      resolve(directory, 'assets/test.js.map'),
      JSON.stringify({
        version: 3,
        sources: ['../../../packages/editor/src/layout.ts'],
        names: [],
        mappings: 'AAEA;AAUA',
      }),
    )
    const location = createTraceLocation(directory)
    const result = await summarizeLayoutTrace(
      [
        layout(200, 50, {
          functionName: 'measure',
          url: 'http://localhost:4173/assets/test.js',
          lineNumber: 1,
          columnNumber: 1,
        }),
      ],
      window,
      location,
    )
    expect(result.callsites[0].callsite).toBe('measure packages/editor/src/layout.ts:3:1')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

function layout(ts, dur, frame) {
  return {
    name: 'Layout',
    ph: 'X',
    ts,
    dur,
    args: { beginData: { stackTrace: frame ? [frame] : [] } },
  }
}
