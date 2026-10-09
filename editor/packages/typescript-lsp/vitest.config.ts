import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { workspaceRoot } from '../../scripts/workspace-root.ts'
import { defineConfig } from 'vitest/config'

const require = createRequire(import.meta.url)
const typeScriptRoot = dirname(require.resolve('typescript-api/package.json'))

export default defineConfig({
  server: { fs: { allow: [workspaceRoot, typeScriptRoot] } },
  test: {
    environment: 'happy-dom',
    exclude: ['**/*.browser.test.ts', '**/node_modules/**'],
  },
})
