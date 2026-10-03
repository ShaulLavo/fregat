import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { acquireStateHomeLock } from '../state-home-lock'

const homes: string[] = []
const holders: Bun.Subprocess[] = []

afterEach(async () => {
  for (const holder of holders.splice(0)) holder.kill('SIGKILL')
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })))
})

async function stateHome() {
  const home = await mkdtemp(path.join(tmpdir(), 'platform-lock-'))
  homes.push(home)
  return home
}

// A real second process: the lock must hold across processes, and end with its holder.
async function holdInChild(home: string) {
  const module = path.join(import.meta.dirname, '..', 'state-home-lock.ts')
  const child = Bun.spawn({
    cmd: [
      process.execPath,
      '-e',
      `const { acquireStateHomeLock } = await import(${JSON.stringify(module)}); acquireStateHomeLock(${JSON.stringify(home)}); console.log('held'); await Bun.sleep(60000)`,
    ],
    stdout: 'pipe',
    stderr: 'inherit',
  })
  holders.push(child)
  const reader = child.stdout.getReader()
  const { value } = await reader.read()
  expect(new TextDecoder().decode(value)).toContain('held')
  return child
}

describe('state home lock', () => {
  it.skipIf(!Bun.which('bash') || process.platform === 'win32')(
    'releases descriptors and ownership after a diagnostic write fails (requires POSIX bash)',
    async () => {
      const home = await stateHome()
      const fixture = path.join(import.meta.dirname, 'fixtures', 'file-lock-write-failure.ts')
      const child = Bun.spawn({
        cmd: [
          'bash',
          '-c',
          'trap "" XFSZ; ulimit -S -f 0; exec "$@"',
          '--',
          process.execPath,
          fixture,
          path.join(home, 'server.lock'),
        ],
        stdout: 'pipe',
        stderr: 'pipe',
      })
      holders.push(child)
      const stderr = new Response(child.stderr).text()
      expect(await child.exited, await stderr).toBe(0)
      acquireStateHomeLock(home).release()
    },
  )

  it('refuses a second server on the same state home while the first lives', async () => {
    const home = await stateHome()
    const holder = await holdInChild(home)
    expect(() => acquireStateHomeLock(home)).toThrow(
      expect.objectContaining({ code: 'system.STATE_HOME_LOCKED' }),
    )
    holder.kill('SIGKILL')
    await holder.exited
    const lock = acquireStateHomeLock(home)
    lock.release()
  })

  it('holds against a second acquire in the same process', async () => {
    const home = await stateHome()
    const lock = acquireStateHomeLock(home)
    expect(() => acquireStateHomeLock(home)).toThrow(
      expect.objectContaining({ code: 'system.STATE_HOME_LOCKED' }),
    )
    lock.release()
    acquireStateHomeLock(home).release()
  })

  it('keeps the lock file private to its owner', async () => {
    const home = await stateHome()
    const lock = acquireStateHomeLock(home)
    expect((await stat(path.join(home, 'server.lock'))).mode & 0o077).toBe(0)
    lock.release()
  })
})
