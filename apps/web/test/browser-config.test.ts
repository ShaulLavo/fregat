import path from 'node:path'
import { loadConfigFromFile } from 'vite'
import { test, expect } from './fixtures'

const browserConfigurations = [
  'vitest.browser.config.ts',
  'vitest.syntax-settings-browser.config.ts',
  'retention-acceptance.vitest.config.ts',
  'retention-acceptance-layout.vitest.config.ts',
]

const markdownQualificationFiles = [
  'src/features/chat/tests/qualification-semantics.browser.tsx',
  'src/features/chat/tests/qualification-production.browser.tsx',
  'src/features/chat/tests/qualification-layout.browser.tsx',
  'src/features/chat/tests/qualification-state.browser.tsx',
  'src/features/chat/tests/qualification-stream.browser.tsx',
  'src/features/chat/tests/qualification.browser.tsx',
  'src/features/chat/tests/qualification-bench.browser.tsx',
]

test('Markdown qualification files stay in the dedicated browser project', async () => {
  const root = path.resolve(import.meta.dirname, '..')
  const generic = await loadConfigFromFile(
    { command: 'serve', mode: 'test' },
    path.join(root, 'vitest.browser.config.ts'),
    root,
  )
  const qualification = await loadConfigFromFile(
    { command: 'serve', mode: 'candidate' },
    path.join(root, 'vitest.markdown-qualification.config.ts'),
    root,
  )

  expect(generic?.config.test?.exclude).toEqual(expect.arrayContaining(markdownQualificationFiles))
  expect(qualification?.config.test?.include).toEqual([
    'src/features/chat/tests/qualification*.browser.tsx',
  ])
  expect(qualification?.config.test?.exclude).toEqual([])
})

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
