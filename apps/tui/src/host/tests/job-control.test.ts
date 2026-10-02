import path from 'node:path'

import { expect, test } from '../../../test/fixtures'

test
  .skipIf(process.platform === 'win32')
  .each(['direct', 'launcher', 'launcher-term', 'shared-shell'])(
  '%s launch preserves foreground job control and terminal modes',
  async (mode) => {
    // NOT-PORTABLE: Requires python3 and /bin/bash; only Windows is excluded.
    const directory = path.resolve(import.meta.dirname, '../../..')
    const result = Bun.spawn({
      cmd: [
        'python3',
        path.join(directory, 'test/processes/job-control.py'),
        process.execPath,
        directory,
        mode,
      ],
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 25_000,
    })
    const [exitCode, stdout, stderr] = await Promise.all([
      result.exited,
      new Response(result.stdout).text(),
      new Response(result.stderr).text(),
    ])
    expect(exitCode, stderr).toBe(0)
    const expected =
      mode === 'shared-shell'
        ? { mode, shellProtected: true, closed: true }
        : { mode, suspended: true, resumed: true, closed: true }
    expect(JSON.parse(stdout)).toEqual(expected)
  },
  30_000,
)
