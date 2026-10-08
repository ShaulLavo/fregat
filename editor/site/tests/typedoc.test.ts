import { test, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

test('the TypeDoc renderer and Starlight theme load the same Markdown plugin', () => {
  const compiler = createRequire(require.resolve('typedoc'))
  const integration = createRequire(require.resolve('starlight-typedoc'))
  expect(compiler.resolve('typedoc-plugin-markdown')).toBe(
    integration.resolve('typedoc-plugin-markdown'),
  )
})
