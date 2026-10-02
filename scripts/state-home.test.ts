import path from 'node:path'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { defaultDevStateHome } from './state-home'

test.each(['absent', 'read-only'])('dev home falls back when /work is %s', () => {
  const home = path.join(path.parse(process.cwd()).root, 'users', 'developer')
  const roots: string[] = []
  const result = defaultDevStateHome(home, (root) => {
    roots.push(root)
    return false
  })
  expect(result).toBe(path.join(home, '.platform-dev'))
  expect(roots).toEqual(['/work'])
})

test('dev home uses the data drive when /work is writable', () => {
  const home = path.join(path.parse(process.cwd()).root, 'users', 'developer')
  expect(defaultDevStateHome(home, (root) => root === '/work')).toBe('/work/platform-dev/home')
})

test('the filesystem probe rejects a writable regular file as the work root', () => {
  const directory = mkdtempSync(path.join(import.meta.dirname, '.state-home-test-'))
  const workRoot = path.join(directory, 'work')
  try {
    writeFileSync(workRoot, '')
    expect(defaultDevStateHome(directory, undefined, workRoot)).toBe(
      path.join(directory, '.platform-dev'),
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('the filesystem probe accepts a writable searchable directory as the work root', () => {
  const directory = mkdtempSync(path.join(import.meta.dirname, '.state-home-test-'))
  try {
    expect(defaultDevStateHome(directory, undefined, directory)).toBe(
      path.join(directory, 'platform-dev', 'home'),
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
