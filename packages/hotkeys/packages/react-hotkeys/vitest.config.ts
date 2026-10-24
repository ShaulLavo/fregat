import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  // Against the core's source: its exports name dist/, which tests must not depend on.
  resolve: {
    alias: {
      '@fregat/hotkeys': fileURLToPath(new URL('../hotkeys/src/index.ts', import.meta.url)),
    },
  },
  test: {
    name: '@fregat/react-hotkeys',
    dir: './tests',
    watch: false,
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
  },
})
