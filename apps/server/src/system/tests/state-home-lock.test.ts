import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { tryFileLock } from '../file-lock'
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

  it('supports the non-FFI lock fallback with same-process exclusion, fresh-empty safety, and stale-PID recovery', async () => {
    const home = await stateHome()
    const lockFile = path.join(home, 'server.lock')

    const lock = tryFileLock(lockFile, { useNativeFfi: false })
    expect(lock).not.toBeNull()
    expect((await stat(lockFile)).mode & 0o077).toBe(0)
    expect(tryFileLock(lockFile, { useNativeFfi: false })).toBeNull()
    lock?.release()

    // A freshly created empty file must not be treated as stale and unlinked.
    await writeFile(lockFile, '', { mode: 0o600 })
    expect(tryFileLock(lockFile, { useNativeFfi: false })).toBeNull()
    await rm(lockFile)

    // Stale lock left by a dead PID is reclaimed cleanly.
    await writeFile(lockFile, '99999999\n', { mode: 0o600 })
    const reclaimed = tryFileLock(lockFile, { useNativeFfi: false })
    expect(reclaimed).not.toBeNull()
    reclaimed?.release()
  })

  it('grants the non-FFI lock to at most one concurrent process', async () => {
    const home = await stateHome()
    const lockFile = path.join(home, 'server.lock')
    const modulePath = path.join(import.meta.dirname, '..', 'file-lock.ts')
    const script = `const { tryFileLock } = await import(${JSON.stringify(modulePath)}); const lock = tryFileLock(${JSON.stringify(lockFile)}, { useNativeFfi: false }); if (!lock) process.exit(2); console.log('won'); await Bun.sleep(400); lock.release();`
    const racers = Array.from({ length: 4 }, () =>
      Bun.spawn({ cmd: [process.execPath, '-e', script], stdout: 'pipe', stderr: 'pipe' }),
    )
    holders.push(...racers)
    const codes = await Promise.all(racers.map((child) => child.exited))
    expect(codes.filter((code) => code === 0)).toHaveLength(1)
    expect(codes.filter((code) => code === 2)).toHaveLength(3)
  })

  it('keeps a live lease held under ENOSYS and reclaims expired locks after a holder crashes', async () => {
    const home = await stateHome()
    const lockFile = path.join(home, 'server.lock')

    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('ENOSYS: function not implemented, kill'), { code: 'ENOSYS' })
    })
    try {
      // Fresh unexpired lease held by another process (even with matching PID, as on WASI pid=1) refuses contenders.
      const future = String(Date.now() + 30_000).padStart(16, '0')
      await writeFile(lockFile, `${process.pid}:aabbccdd00112233:${future}\n`, { mode: 0o600 })
      expect(tryFileLock(lockFile, { useNativeFfi: false, leaseTtlMs: 200 })).toBeNull()

      // Expired lease left behind by a crashed WASI holder is reclaimed cleanly.
      const expired = String(Date.now() - 1_000).padStart(16, '0')
      await writeFile(lockFile, `${process.pid}:deadbeef00112233:${expired}\n`, { mode: 0o600 })
      const reclaimed = tryFileLock(lockFile, { useNativeFfi: false, leaseTtlMs: 200 })
      expect(reclaimed).not.toBeNull()
      reclaimed?.release()
    } finally {
      killSpy.mockRestore()
    }

    // Live holder heartbeat keeps the lease fresh past leaseTtlMs; killing it lets the next owner recover.
    const modulePath = path.join(import.meta.dirname, '..', 'file-lock.ts')
    const holderScript = `
      const { tryFileLock } = await import(${JSON.stringify(modulePath)});
      const lock = tryFileLock(${JSON.stringify(lockFile)}, { useNativeFfi: false, leaseTtlMs: 250 });
      if (!lock) process.exit(2);
      console.log('held');
      await Bun.sleep(60000);
    `
    const holder = Bun.spawn({
      cmd: [process.execPath, '-e', holderScript],
      stdout: 'pipe',
      stderr: 'inherit',
    })
    holders.push(holder)
    const reader = holder.stdout.getReader()
    const { value } = await reader.read()
    expect(new TextDecoder().decode(value)).toContain('held')

    await Bun.sleep(400)
    const spyDuringLive = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('ENOSYS: function not implemented, kill'), { code: 'ENOSYS' })
    })
    try {
      expect(tryFileLock(lockFile, { useNativeFfi: false, leaseTtlMs: 250 })).toBeNull()
      holder.kill('SIGKILL')
      await holder.exited
      await Bun.sleep(350)
      const afterCrash = tryFileLock(lockFile, { useNativeFfi: false, leaseTtlMs: 250 })
      expect(afterCrash).not.toBeNull()
      afterCrash?.release()
    } finally {
      spyDuringLive.mockRestore()
    }
  })

  it('grants at most one concurrent lock when reclaiming a stale lock with a stale witness', async () => {
    const home = await stateHome()
    const lockFile = path.join(home, 'server.lock')
    await writeFile(lockFile, '99999999:dead0001\n', { mode: 0o600 })
    await writeFile(`${lockFile}.reclaim.dead0001`, '99999998:dead0002\n', { mode: 0o600 })

    const modulePath = path.join(import.meta.dirname, '..', 'file-lock.ts')
    const script = `const { tryFileLock } = await import(${JSON.stringify(modulePath)}); const lock = tryFileLock(${JSON.stringify(lockFile)}, { useNativeFfi: false }); if (!lock) process.exit(2); await Bun.sleep(400); lock.release();`
    const racers = Array.from({ length: 4 }, () =>
      Bun.spawn({ cmd: [process.execPath, '-e', script], stdout: 'pipe', stderr: 'pipe' }),
    )
    holders.push(...racers)
    const codes = await Promise.all(racers.map((child) => child.exited))
    expect(codes.filter((code) => code === 0)).toHaveLength(1)
    expect(codes.filter((code) => code === 2)).toHaveLength(3)
  })
})
