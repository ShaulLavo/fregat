import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { liveTerminalEnv } from './live-terminal-env'

const bash = Bun.which('bash')
test.skipIf(!bash || process.platform === 'win32').each(['success', 'cleanup'] as const)(
  'leaves external shell history byte-identical after %s',
  async (mode) => {
    const root = await mkdtemp(path.join(tmpdir(), 'live-history-'))
    const home = path.join(root, 'home')
    const history = path.join(root, 'external-history')
    const original = 'first command\nsecond command\nthird command\n'
    await mkdir(home)
    await writeFile(history, original)
    const env = liveTerminalEnv(home, bash!, {
      PATH: process.env.PATH,
      HISTFILE: history,
      HISTFILESIZE: '1',
      HISTSIZE: '100',
    })
    const command =
      mode === 'success'
        ? 'history -s private-command; exit'
        : 'trap "exit" TERM; history -s private-command; echo ready; read -r waiting'
    const child = Bun.spawn([bash!, '--noprofile', '--norc', '-i', '-c', command], {
      env,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    try {
      if (mode === 'cleanup') {
        const reader = child.stdout.getReader()
        expect(new TextDecoder().decode((await reader.read()).value)).toContain('ready')
        reader.releaseLock()
        child.kill('SIGTERM')
      }
      expect(await child.exited).toBe(0)
      expect(await readFile(history, 'utf8')).toBe(original)
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL')
      await child.exited
      await rm(root, { recursive: true, force: true })
    }
  },
)

test('the private process environment admits only explicit execution and locale inputs', () => {
  const inherited = {
    PATH: 'fixture-bin',
    LANG: 'C',
    LC_ALL: 'C',
    HISTFILE: 'external',
    HISTFILESIZE: '1',
    BASH_ENV: 'startup',
    ENV: 'startup',
    SHELLOPTS: 'xtrace',
    BASHOPTS: 'extdebug',
    LD_PRELOAD: 'library',
    NODE_OPTIONS: '--require=external',
    XDG_CONFIG_HOME: 'external',
  }
  expect(liveTerminalEnv('/private', '/bin/sh', inherited)).toEqual({
    HOME: '/private',
    SHELL: '/bin/sh',
    PATH: 'fixture-bin',
    LANG: 'C',
    LC_ALL: 'C',
    PS1: 'fregat-live-check$ ',
    HISTFILE: path.join('/private', 'history'),
    TMPDIR: '/private',
  })
})
