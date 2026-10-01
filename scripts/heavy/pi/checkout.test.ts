import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'

import { FREGAT, fregatCheckout } from './checkout'

const FREGAT_URL = 'https://github.com/ShaulLavo/fregat.git'
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

function scratch(prefix: string) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)))
  roots.push(dir)
  return dir
}

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    encoding: 'utf8',
  }).trim()
}

/** A two-commit repository with a subdirectory; its root commit stands in for Fregat's. */
function fullRepository() {
  const root = scratch('fregat-full-')
  git(root, 'init', '-q')
  mkdirSync(path.join(root, 'scripts'))
  writeFileSync(path.join(root, 'scripts/a'), '1')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'first')
  writeFileSync(path.join(root, 'scripts/a'), '2')
  git(root, 'commit', '-qam', 'second')
  return { root, rootCommit: git(root, 'rev-list', '--max-parents=0', 'HEAD') }
}

/** A depth-1 clone, as CI checks out: the root commit is not in its history. */
function shallowClone(source: string, origin: string | null) {
  const clone = path.join(scratch('fregat-shallow-'), 'clone')
  execFileSync('git', ['clone', '-q', '--depth', '1', `file://${source}`, clone])
  if (origin) git(clone, 'remote', 'set-url', 'origin', origin)
  else git(clone, 'remote', 'remove', 'origin')
  expect(git(clone, 'rev-parse', '--is-shallow-repository')).toBe('true')
  return clone
}

test('a full clone is Fregat when its history holds the root commit', () => {
  const { root, rootCommit } = fullRepository()
  const identity = { ...FREGAT, rootCommit }
  expect(fregatCheckout(path.join(root, 'scripts'), identity)).toBe(root)
})

test('a full clone without the root commit is refused, whatever its origin says', () => {
  const { root } = fullRepository()
  git(root, 'remote', 'add', 'origin', FREGAT_URL)
  expect(() => fregatCheckout(root, FREGAT)).toThrow(/not a Fregat checkout/)
})

test('a shallow clone is Fregat when its origin is the Fregat repository', () => {
  const { root, rootCommit } = fullRepository()
  const clone = shallowClone(root, FREGAT_URL)
  expect(fregatCheckout(path.join(clone, 'scripts'), { ...FREGAT, rootCommit })).toBe(clone)
  const ssh = shallowClone(root, 'git@github.com:ShaulLavo/fregat.git')
  expect(fregatCheckout(ssh, { ...FREGAT, rootCommit })).toBe(ssh)
})

test('a shallow clone with another origin, or none, is refused', () => {
  const { root, rootCommit } = fullRepository()
  const identity = { ...FREGAT, rootCommit }
  expect(() =>
    fregatCheckout(shallowClone(root, 'https://github.com/someone/fregat.git'), identity),
  ).toThrow(/shallow clone/)
  expect(() => fregatCheckout(shallowClone(root, null), identity)).toThrow(/shallow clone/)
})

test('a directory outside git is refused', () => {
  expect(() => fregatCheckout(scratch('no-git-'))).toThrow(/not inside a git checkout/)
})

test.each([
  'https://ci:s3cr3t-token@github.com/someone/fregat.git',
  'https://s3cr3t-token@github.com/someone/fregat.git',
  'ssh://git:s3cr3t-token@github.com/someone/fregat.git',
  's3cr3t-token@github.com:someone/fregat.git',
])('never puts credentials from the origin %s into the refusal', (origin) => {
  const { root, rootCommit } = fullRepository()
  const clone = shallowClone(root, origin)
  let message = ''
  try {
    fregatCheckout(clone, { ...FREGAT, rootCommit })
  } catch (error) {
    message = `${String(error)} ${JSON.stringify(error)}`
  }
  expect(message).toMatch(/shallow clone/)
  expect(message).toContain('github.com')
  expect(message).not.toContain('s3cr3t-token')
})
