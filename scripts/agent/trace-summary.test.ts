import { describe, expect, test } from 'vitest'

import { attributeSamples, decodeMainThreadSamples } from './trace-profile'
import { sourceResolver } from './trace-source-maps'
import { formatTraceSummary, summarizeTrace } from './trace-summary'
import { readTrace, type GeneratedFrame } from './trace-types'

const main = { pid: 1, tid: 10 }
const url = 'http://localhost:5173/src/paste.ts'

function profile(pid = 1, tid = 10, id = 'main') {
  return { name: 'Profile', ph: 'P', pid, tid, id, ts: 0, args: { data: { startTime: 0 } } }
}

function node(id: number, functionName: string, parent = 0, source = url) {
  return {
    id,
    parent,
    callFrame: { functionName, scriptId: 5, url: source, lineNumber: 2, columnNumber: 0 },
  }
}

function chunk(data: unknown, ts = 0, pid = 1, id = 'main') {
  return { name: 'ProfileChunk', ph: 'P', pid, tid: 99, id, ts, args: { data } }
}

function event(name: string, ts: number, dur = 0, ph = 'X') {
  return { name, ts, dur, ph, ...main }
}

function mark(name: string, ts: number) {
  return { ...event(name, ts, 0, 'I'), cat: 'blink.user_timing' }
}

describe('sampled application frame attribution', () => {
  test('joins collector chunks to their originating thread and isolates process/profile node ids', () => {
    const events = readTrace(
      JSON.stringify([
        profile(),
        profile(1, 20, 'worker'),
        profile(2, 10),
        chunk({
          cpuProfile: { nodes: [node(1, 'paste')], samples: [1, 1] },
          timeDeltas: [1000, 1000],
        }),
        chunk(
          { cpuProfile: { nodes: [node(1, 'worker')], samples: [1, 1] }, timeDeltas: [1000, 1000] },
          0,
          1,
          'worker',
        ),
        chunk(
          {
            cpuProfile: { nodes: [node(1, 'other-process')], samples: [1, 1] },
            timeDeltas: [1000, 1000],
          },
          0,
          2,
        ),
      ]),
    )

    const frames = attributeSamples({ ts: 0, dur: 3000 }, decodeMainThreadSamples(events, main))
    expect(frames.map((frame) => [frame.generated.functionName, frame.sampledMs])).toEqual([
      ['paste', 1],
    ])
  })

  test('sorts signed timestamps across chunks, resolves later node definitions, and clips intervals to tasks', () => {
    const events = readTrace(
      JSON.stringify([
        profile(),
        chunk({ cpuProfile: { samples: [2, 3] }, timeDeltas: [1000, 1000] }, 10),
        chunk(
          {
            cpuProfile: {
              nodes: [node(1, 'root'), node(2, 'paste', 1), node(3, 'layout', 1)],
              samples: [2, 1],
            },
            timeDeltas: [-500, 1500],
          },
          20,
        ),
      ]),
    )
    const samples = decodeMainThreadSamples(events, main)

    expect(samples.map((sample) => [sample.startUs, sample.endUs])).toEqual([
      [1000, 1500],
      [1500, 2000],
      [2000, 3000],
    ])
    const frames = attributeSamples({ ts: 1250, dur: 1000 }, samples)
    expect(frames.map((frame) => [frame.generated.functionName, frame.sampledMs])).toEqual([
      ['paste', 0.75],
      ['layout', 0.25],
    ])
    expect(attributeSamples({ ts: 0, dur: 1000 }, samples)).toEqual([])
    expect(attributeSamples({ ts: 3000, dur: 1000 }, samples)).toEqual([])
  })

  test('attributes each interval once to its deepest application ancestor, including dependency callees', () => {
    const events = readTrace(
      JSON.stringify([
        profile(),
        chunk({
          cpuProfile: {
            nodes: [
              node(1, 'paste'),
              node(2, 'paste', 1),
              node(3, 'dependency', 2, 'http://localhost/node_modules/render.js'),
            ],
            samples: [3, 3],
          },
          timeDeltas: [0, 1000],
        }),
      ]),
    )
    const frames = attributeSamples({ ts: 0, dur: 1000 }, decodeMainThreadSamples(events, main))
    expect(frames).toHaveLength(1)
    expect(frames[0]?.generated.functionName).toBe('paste')
    expect(frames[0]?.sampledMs).toBe(1)
  })

  test('includes local Editor packages as application code', () => {
    const events = readTrace(
      JSON.stringify([
        profile(),
        chunk({
          cpuProfile: {
            nodes: [
              node(
                1,
                'writeNativeScrollTop',
                0,
                'http://localhost:5173/@fs/work/projects/Editor/packages/editor/dist/scroll.js',
              ),
            ],
            samples: [1, 1],
          },
          timeDeltas: [0, 1000],
        }),
      ]),
    )
    expect(
      attributeSamples({ ts: 0, dur: 1000 }, decodeMainThreadSamples(events, main))[0]?.generated
        .functionName,
    ).toBe('writeNativeScrollTop')
  })
})

describe('trace task summaries', () => {
  test('shows the worst task in the pasted phase even when no task exceeds 50ms', () => {
    const raw = JSON.stringify([
      mark('fregat:scenario:start', 100),
      event('RunTask', 200, 100),
      mark('fregat:step:opened', 1000),
      event('RunTask', 2000, 20_000),
      event('RunTask', 30_000, 15_000),
      mark('fregat:step:pasted', 50_000),
      profile(),
      chunk({
        cpuProfile: { nodes: [node(1, 'paste')], samples: [1, 1] },
        timeDeltas: [2000, 20_000],
      }),
    ])
    const summary = summarizeTrace(raw)

    expect(summary.longTasks).toEqual([])
    expect(summary.worstTaskMs).toBe(20)
    expect(summary.phaseTasks.find((task) => task.phase === 'pasted')).toMatchObject({
      durationMs: 20,
      sampledFrames: [{ generated: { functionName: 'paste' }, sampledMs: 20 }],
    })
    expect(formatTraceSummary(summary).join('\n')).toContain('20ms sampled')
  })

  test('retains FunctionCall fallback with an explicit wall-time label when no app samples exist', () => {
    const raw = JSON.stringify([
      event('RunTask', 0, 60_000),
      {
        ...event('FunctionCall', 1000, 55_000),
        args: { data: { functionName: 'commit', url: 'react-dom.js', lineNumber: 10 } },
      },
    ])
    const summary = summarizeTrace(raw)
    expect(summary.longTasks[0]?.sampledFrames).toEqual([])
    expect(formatTraceSummary(summary).join('\n')).toContain('55ms FunctionCall wall')
  })
})

test('maps zero-based generated locations to one-based original locations and preserves identity', () => {
  const frame: GeneratedFrame = { scriptId: '5', functionName: 'minified', url, line: 2, column: 0 }
  const source = {
    scriptId: '5',
    url,
    mapUrl: 'http://localhost:5173/assets/paste.js.map',
    map: JSON.stringify({
      version: 3,
      sources: ['../src/paste.ts'],
      names: ['insertPastedContent'],
      mappings: ';;AAKIA',
    }),
  }
  const resolve = sourceResolver([source])
  expect(resolve(frame)).toEqual({
    functionName: 'insertPastedContent',
    source: url,
    line: 6,
    column: 5,
  })
  expect(resolve({ ...frame, url: 'http://localhost/other.js' })).toBeNull()
  expect(resolve({ ...frame, line: 0 })).toBeNull()

  const raw = JSON.stringify([
    event('RunTask', 0, 60_000),
    profile(),
    chunk({
      cpuProfile: { nodes: [node(1, 'minified')], samples: [1, 1] },
      timeDeltas: [0, 60_000],
    }),
  ])
  const summary = summarizeTrace(raw, [source])
  expect(summary.longTasks[0]?.sampledFrames[0]).toEqual({
    generated: frame,
    original: resolve(frame),
    sampledMs: 60,
  })
})
