import path from 'node:path'
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
