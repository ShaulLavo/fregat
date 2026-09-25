import { describe } from 'vitest'

import { expect, test as it } from '../../../../../test/fixtures'
import { stackFrameSegments, stackFrames } from '@/features/chat/utils/stack-frames'

// Captured from real runs; only the checkout path was replaced.
const BUN_TRACE = `1 | function parseConfig(text: string) {
2 |   throw new Error('Unexpected token in config')
                ^
error: Unexpected token in config
      at parseConfig (/work/projects/app/src/config.ts:2:13)
      at /work/projects/app/src/config.ts:7:1

Bun v1.4.0 (Linux x64)`

const NODE_TRACE = `file:///work/projects/app/src/config.mjs:2
  throw new Error('Unexpected token in config')
        ^

Error: Unexpected token in config
    at parseConfig (file:///work/projects/app/src/config.mjs:2:9)
    at load (file:///work/projects/app/src/config.mjs:5:10)
    at ModuleJob.run (node:internal/modules/esm/module_job:569:25)
    at async node:internal/modules/esm/loader:650:26`

const VITEST_TRACE = ` ❯ getElementError ../../node_modules/.bun/@testing-library+dom@10.4.1/node_modules/@testing-library/dom/dist/config.js:37:22
 ❯ src/features/chat/components/tests/activity-row.test.tsx:190:32
    188|   )
    189|   expect(screen.queryByLabelText('Reasoning')).not.toBeInTheDocument()
    190|   await userEvent.click(screen.getByRole('button', { name: reasoning }…`

const TSC_OUTPUT = `src/features/chat/utils/tests/timeline-scroll-anchoring.test.ts(30,9): error TS2741: Property 'tail' is missing in type '{ active: true; }' but required in type 'ChatLiveActivity'.`

const PYTHON_TRACE = `Traceback (most recent call last):
  File "/work/projects/app/boom.py", line 5, in <module>
    load()
    ~~~~^^
  File "/work/projects/app/boom.py", line 2, in parse
    raise ValueError("bad config")
ValueError: bad config`

function frames(trace: string) {
  return trace
    .split('\n')
    .flatMap(stackFrames)
    .map(({ column, external, line, path }) => ({ column, external, line, path }))
}

describe('stack frames', () => {
  it('reads Bun frames and leaves the code excerpt alone', () => {
    expect(frames(BUN_TRACE)).toEqual([
      { column: 13, external: false, line: 2, path: '/work/projects/app/src/config.ts' },
      { column: 1, external: false, line: 7, path: '/work/projects/app/src/config.ts' },
    ])
  })

  it('reads Node frames behind file:// and mutes node: internals', () => {
    expect(frames(NODE_TRACE)).toEqual([
      { column: null, external: false, line: 2, path: '/work/projects/app/src/config.mjs' },
      { column: 9, external: false, line: 2, path: '/work/projects/app/src/config.mjs' },
      { column: 10, external: false, line: 5, path: '/work/projects/app/src/config.mjs' },
      {
        column: 25,
        external: true,
        line: 569,
        path: 'node:internal/modules/esm/module_job:569:25',
      },
      { column: 26, external: true, line: 650, path: 'node:internal/modules/esm/loader:650:26' },
    ])
  })

  it('reads Vitest frames and mutes node_modules', () => {
    expect(frames(VITEST_TRACE)).toEqual([
      {
        column: 22,
        external: true,
        line: 37,
        path: '../../node_modules/.bun/@testing-library+dom@10.4.1/node_modules/@testing-library/dom/dist/config.js',
      },
      {
        column: 32,
        external: false,
        line: 190,
        path: 'src/features/chat/components/tests/activity-row.test.tsx',
      },
    ])
  })

  it('reads tsc diagnostics', () => {
    expect(frames(TSC_OUTPUT)).toEqual([
      {
        column: 9,
        external: false,
        line: 30,
        path: 'src/features/chat/utils/tests/timeline-scroll-anchoring.test.ts',
      },
    ])
  })

  it('reads Python frames', () => {
    expect(frames(PYTHON_TRACE)).toEqual([
      { column: null, external: false, line: 5, path: '/work/projects/app/boom.py' },
      { column: null, external: false, line: 2, path: '/work/projects/app/boom.py' },
    ])
  })

  it('leaves URLs and times as text', () => {
    expect(stackFrames('GET http://localhost:5173/app.js:12 at 12:30:45')).toEqual([])
  })

  it('cuts a line into text and frames that join back to the line', () => {
    const line = '      at parseConfig (/work/projects/app/src/config.ts:2:13)'
    const segments = stackFrameSegments(line)

    expect(segments.map((segment) => segment.text).join('')).toBe(line)
    expect(segments.map((segment) => segment.frame !== null)).toEqual([false, true, false])
  })
})
