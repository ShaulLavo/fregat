import { workspaceRoot } from '../../scripts/workspace-root'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  server: { fs: { allow: [workspaceRoot] } },
  test: {
    environment: 'happy-dom',
  },
})
