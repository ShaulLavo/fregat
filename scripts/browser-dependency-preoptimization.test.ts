import path from 'node:path'
import { expect, test } from 'vitest'

const workspaceRoot = path.resolve(import.meta.dirname, '..')

const configurations = [
  'apps/web/vitest.browser.config.ts',
  'apps/web/vitest.syntax-settings-browser.config.ts',
]

// Late discovery rebuilds shared Vitest chunks while tests still own their first runtime.
test.each(configurations)('%s preoptimizes lazy shared UI dependencies', async (configuration) => {
  const config = (await import(path.join(workspaceRoot, configuration))).default
  expect(config.optimizeDeps.include).toEqual(
    expect.arrayContaining([
      '@workspace/ui > @base-ui/react/accordion',
      '@workspace/ui > @base-ui/react/drawer',
    ]),
  )
})
