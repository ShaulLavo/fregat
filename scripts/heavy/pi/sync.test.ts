import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'

import { buildsTransfer, pushCheckout } from './sync'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

function scratch(prefix: string) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

test('copies built workspaces to their own paths from any working directory', () => {
  const root = scratch('lane-sync-root-')
  const builds = ['editor/packages/editor/dist', 'ghostty-webgpu/dist']
  for (const dist of builds) {
    mkdirSync(path.join(root, dist), { recursive: true })
    writeFileSync(path.join(root, dist, 'index.js'), '')
  }
  const destination = scratch('lane-sync-dest-')
  const elsewhere = scratch('lane-sync-cwd-')
  const [command, ...args] = buildsTransfer(root, builds, `${destination}/`)
  expect(spawnSync(command!, args, { cwd: elsewhere }).status).toBe(0)
  for (const dist of builds) expect(existsSync(path.join(destination, dist, 'index.js'))).toBe(true)
})

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    encoding: 'utf8',
    stdio: 'pipe',
  }).trim()
}

/** A source with commits A, B, C; a full receiver cloned at A, as the Pi's lane checkout is. */
function olderReceiver() {
  const source = scratch('lane-push-source-')
  const receiver = path.join(scratch('lane-push-receiver-'), 'receiver')
  git(source, 'init', '-q')
  for (const name of ['A', 'B', 'C']) {
    writeFileSync(path.join(source, 'file'), name)
    git(source, 'add', 'file')
    git(source, 'commit', '-qm', name)
    if (name === 'A') execFileSync('git', ['clone', '-q', source, receiver])
  }
  return { source, receiver, head: git(source, 'rev-parse', 'HEAD') }
}

function shallowSource(source: string) {
  const clone = path.join(scratch('lane-push-shallow-'), 'clone')
  execFileSync('git', ['clone', '-q', '--depth', '1', `file://${source}`, clone])
  expect(git(clone, 'rev-parse', '--is-shallow-repository')).toBe('true')
  return clone
}

test('pushes a shallow source into an older full receiver', () => {
  const { source, receiver, head } = olderReceiver()
  pushCheckout(shallowSource(source), receiver)
  expect(git(receiver, 'rev-parse', 'refs/heads/lane')).toBe(head)
  expect(git(receiver, 'rev-parse', '--is-shallow-repository')).toBe('false')
})

test('refuses a shallow source that cannot fetch its history, and says how to fix it', () => {
  const { source, receiver } = olderReceiver()
  const clone = shallowSource(source)
  git(clone, 'remote', 'set-url', 'origin', path.join(source, 'missing'))
  expect(() => pushCheckout(clone, receiver)).toThrow(/fetch --unshallow origin`, then sync again/)
})
