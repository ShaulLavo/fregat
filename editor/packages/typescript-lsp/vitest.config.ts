import { workspaceRoot } from '../../scripts/workspace-root.ts'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  server: { fs: { allow: [workspaceRoot] } },
  test: {
    environment: 'happy-dom',
    exclude: ['**/*.browser.test.ts', '**/node_modules/**'],
  },
})
