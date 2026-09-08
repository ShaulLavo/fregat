import path from 'node:path'
import { expect, test } from '../../../test/fixtures'

test.runIf(process.platform === 'linux' && Bun.which('nvim'))(
  'raw attach runs Neovim on a real host PTY and restores the interactive application',
  async () => {
    const directory = path.resolve(import.meta.dirname, '../../..')
    const child = Bun.spawn({
      cmd: [
        'python3',
        path.join(directory, 'test/processes/terminal-attach.py'),
        process.execPath,
        directory,
      ],
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 25_000,
    })
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(exitCode, stderr).toBe(0)
    expect(JSON.parse(stdout)).toEqual({
      vim: true,
      resize: true,
      detached: true,
      resumed: true,
      modesRestored: true,
    })
  },
  30_000,
)
