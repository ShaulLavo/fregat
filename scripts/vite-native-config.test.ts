import { createRequire } from 'node:module'
import path from 'node:path'
import { expect, test } from 'vitest'

const repository = path.resolve(import.meta.dirname, '..')
const require = createRequire(path.join(repository, 'editor/package.json'))
const { createLogger, loadConfigFromFile } = await import(require.resolve('vite'))

const configurations = [
  'apps/server/vitest.config.ts',
  'apps/web/vitest.config.ts',
  'apps/web/vitest.browser.config.ts',
  'apps/web/vitest.tree-browser.config.ts',
  'ghostty-webgpu/vitest.browser.config.ts',
  'editor/packages/editor/vitest.config.ts',
  'editor/packages/highlighting/vitest.config.ts',
  'editor/packages/typescript-lsp/vitest.config.ts',
]

for (const loader of ['bundle', 'native'] as const) {
  test.each(configurations)(
    '%s loads with ' + loader + ' without native compatibility warnings',
    async (relative) => {
      const configFile = path.join(repository, relative)
      const warnings: string[] = []
      const logger = createLogger()
      logger.warn = (message: string) => warnings.push(message)
      const result = await loadConfigFromFile(
        { command: 'serve', mode: 'test' },
        configFile,
        path.dirname(configFile),
        'warn',
        logger,
        loader,
      )
      expect(result?.config.test).toBeDefined()
      expect(warnings.filter((message) => message.includes("configLoader: 'native'"))).toEqual([])
    },
  )
}
