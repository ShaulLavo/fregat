import { spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { expect, test } from 'vitest'

import { traceFocus } from '../../../test/focus-trace'

const tui = path.resolve(import.meta.dirname, '../../..')

test('a traced test that times out still prints its trace and restores what it wrapped', () => {
  const run = spawnSync(
    process.execPath,
    [
      '--bun',
      'vitest',
      'run',
      '--config',
      'test/processes/focus-trace.vitest.config.ts',
      '--reporter=verbose',
    ],
    { cwd: tui, encoding: 'utf8' },
  )
  // CI forces colour; the reporter's escape codes sit between the marks and the names.
  const output = stripVTControlCharacters(`${run.stdout}${run.stderr}`)
  expect(output).toContain('focus trace at')
  expect(output).toMatch(/✓ .*the next test sees the real timers and focus registry/)
  expect(output).toMatch(/× .*times out while traced/)
}, 60_000)

test('a traced timer keeps its native receiver and arguments', async () => {
  type Seen = { receiver: string; args: readonly unknown[] }
  const observe = () =>
    new Promise<Seen>((resolve) => {
      setTimeout(
        function (this: unknown, ...args: unknown[]) {
          resolve({ args, receiver: Object.prototype.toString.call(this) })
        },
        0,
        'first',
        2,
      )
    })
  const native = await observe()
  const renderer = Object.assign(new EventEmitter(), { currentFocusedRenderable: null })
  traceFocus({ renderer } as never)
  const traced = await observe()
  expect(traced).toEqual(native)
  expect(traced.args).toEqual(['first', 2])
})
