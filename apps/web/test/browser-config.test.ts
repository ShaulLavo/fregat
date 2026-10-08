import path from 'node:path'
import { loadConfigFromFile } from 'vite'
import { test, expect } from './fixtures'

const browserConfigurations = [
  'vitest.browser.config.ts',
  'vitest.syntax-settings-browser.config.ts',
  'retention-acceptance.vitest.config.ts',
  'retention-acceptance-layout.vitest.config.ts',
]

test('standalone browser projects have distinct optimizer cache identities', async () => {
  const root = path.resolve(import.meta.dirname, '..')
  const names = []

  for (const configuration of browserConfigurations) {
    const loaded = await loadConfigFromFile(
      { command: 'serve', mode: 'test' },
      path.join(root, configuration),
      root,
    )
    const name = loaded?.config.test?.name
    expect(typeof name, configuration).toBe('string')
    expect(name, configuration).not.toBe('')
    names.push(name)
  }

  expect(new Set(names).size, JSON.stringify(names)).toBe(names.length)
})
