import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'

import { tryLock, unlock } from '../lock'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

const entry = (name: string) => path.join(import.meta.dirname, name)

function scratch(prefix: string) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

/**
 * The checkout the CLIs run from: a depth-1 clone whose origin is Fregat's, as CI checks out,
 * with the files their local checks read, so the test never depends on this checkout's depth
 * or build state.
 */
function laneCheckout() {
  const source = scratch('lane-lock-source-')
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args])
  git(source, 'init', '-q')
  writeFileSync(path.join(source, 'package.json'), '{ "packageManager": "bun@1.4.2" }\n')
  git(source, 'add', '.')
  git(source, 'commit', '-qm', 'first')
  git(source, 'commit', '-q', '--allow-empty', '-m', 'second')
  const clone = path.join(scratch('lane-lock-clone-'), 'fregat')
  execFileSync('git', ['clone', '-q', '--depth', '1', `file://${source}`, clone])
  git(clone, 'remote', 'set-url', 'origin', 'https://github.com/ShaulLavo/fregat.git')
  mkdirSync(path.join(clone, 'editor/packages/editor/dist'), { recursive: true })
  writeFileSync(path.join(clone, 'editor/packages/editor/dist/index.js'), '')
  mkdirSync(path.join(clone, 'hotkeys/packages'), { recursive: true })
  return clone
}

// The host does not resolve: anything that gets past the lock fails at once on ssh.
test.each([
  ['run.ts', ['--host', 'nonexistent.invalid', 'locked', '--', 'true']],
  ['sync.ts', ['--host', 'nonexistent.invalid']],
  ['setup.ts', ['--host', 'nonexistent.invalid']],
])(
  '%s waits for the Pi lock before it reaches the Pi',
  async (script, args) => {
    const locks = scratch('lane-lock-')
    const held = tryLock(path.join(locks, 'pi.lock'))!
    const child = Bun.spawn(['bun', entry(script), '--lock-dir', locks, ...args], {
      cwd: laneCheckout(),
      stdout: 'ignore',
      stderr: 'pipe',
    })
    await Bun.sleep(1_500)
    expect(child.exitCode).toBeNull()
    unlock(held)
    const exit = await child.exited
    const stderr = await new Response(child.stderr).text()
    expect(stderr).toContain('the Pi lane is busy')
    expect(exit).not.toBe(0)
  },
  30_000,
)
