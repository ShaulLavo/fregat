import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'

import { cmdlineWriteScript, repairCmdline } from './cmdline'

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, 'fixtures/cmdline', `${name}.txt`), 'utf8')
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

test('adds both flags to a stock line without adding a newline', () => {
  const { text, added } = repairCmdline(fixture('stock'))
  expect(added).toEqual(['cgroup_enable=memory', 'psi=1'])
  expect(text).toBe(`${fixture('stock')} cgroup_enable=memory psi=1`)
})

test('adds only the missing flag when one is present', () => {
  expect(repairCmdline(fixture('memory-only'))).toEqual({
    text: `${fixture('memory-only')} psi=1`,
    added: ['psi=1'],
  })
  expect(repairCmdline(fixture('psi-only'))).toEqual({
    text: `${fixture('psi-only')} cgroup_enable=memory`,
    added: ['cgroup_enable=memory'],
  })
})

test('leaves an already flagged line unchanged, so a rerun adds nothing', () => {
  expect(repairCmdline(fixture('flagged'))).toEqual({ text: fixture('flagged'), added: [] })
  const once = repairCmdline(fixture('stock')).text
  expect(repairCmdline(once)).toEqual({ text: once, added: [] })
})

test('keeps an existing single trailing newline', () => {
  const { text } = repairCmdline(fixture('trailing-newline'))
  expect(text).toBe('console=tty1 root=PARTUUID=27db7512-02 rootwait cgroup_enable=memory psi=1\n')
})

test.each(['two-lines', 'no-root', 'psi-off', 'empty'])(
  'refuses the unexpected layout %s',
  (name) => {
    expect(() => repairCmdline(fixture(name))).toThrow()
  },
)

function writeWithScript(file: string, backup: string, text: string) {
  const result = spawnSync('bash', ['-c', cmdlineWriteScript(file, backup, '')], { input: text })
  expect(result.status).toBe(0)
}

test('backs up the original once and writes the exact bytes', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'cmdline-'))
  roots.push(root)
  const file = path.join(root, 'cmdline.txt')
  const backup = `${file}.before-lane`
  writeFileSync(file, fixture('stock'))

  writeWithScript(file, backup, repairCmdline(fixture('stock')).text)
  writeWithScript(file, backup, 'second write')

  expect(readFileSync(backup, 'utf8')).toBe(fixture('stock'))
  expect(readFileSync(file, 'utf8')).toBe('second write')
})
