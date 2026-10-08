import { readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'

test('the native clipboard proof chooses the platform paste modifier', async () => {
  const config = await readFile(new URL('../vitest.editor.config.ts', import.meta.url), 'utf8')
  expect(config).toContain("keyboard.press('ControlOrMeta+V')")
})
