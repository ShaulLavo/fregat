import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const readme = readFileSync(path.join(root, 'hotkeys/README.md'), 'utf8')

test('hotkeys introduces the library without a Fregat hero or a prescribed keymap', () => {
  expect(readme).not.toContain('docs/images/workbench.webp')
  expect(readme).not.toContain('Zed-style keymaps')
  expect(readme).toContain('Keyboard shortcuts for editors and complex apps.')
  expect(readme).toContain('Your app supplies the keymap')
  expect(readme).toContain("Context predicates and chord dispatch follow Zed's model.")
  expect(readme.trimEnd().split('\n').length).toBeLessThanOrEqual(100)
})

test('hotkeys credits its upstream library and author', () => {
  expect(readme).toContain('TanStack Hotkeys')
  expect(readme).toContain('Tanner Linsley')
  expect(readme).toContain('MIT')
})

test('the parts table describes hotkeys without prescribing a keymap', () => {
  const parts = readFileSync(path.join(root, 'README.md'), 'utf8')
  expect(parts).not.toContain('Zed-style keymaps')
  expect(parts).toContain('Keyboard shortcuts for editors and complex apps.')
})
