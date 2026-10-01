import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'

import { tryLock, unlock } from '../lock'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

const entry = (name: string) => path.join(import.meta.dirname, name)

// The host does not resolve: anything that gets past the lock fails at once on ssh.
test.each([
  ['run.ts', ['--host', 'nonexistent.invalid', 'locked', '--', 'true']],
  ['sync.ts', ['--host', 'nonexistent.invalid']],
  ['setup.ts', ['--host', 'nonexistent.invalid']],
])(
  '%s waits for the Pi lock before it reaches the Pi',
  async (script, args) => {
    const locks = mkdtempSync(path.join(tmpdir(), 'lane-lock-'))
    roots.push(locks)
    const held = tryLock(path.join(locks, 'pi.lock'))!
    const child = Bun.spawn(['bun', entry(script), '--lock-dir', locks, ...args], {
      stdout: 'ignore',
      stderr: 'pipe',
    })
    await Bun.sleep(1_500)
    expect(child.exitCode).toBeNull()
    unlock(held)
    const exit = await child.exited
    const stderr = await new Response(child.stderr).text()
    expect(stderr).toContain('the Pi slot is busy')
    expect(exit).not.toBe(0)
  },
  30_000,
)
