import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: '@fregat/hotkeys',
    dir: './tests',
    watch: false,
    environment: 'happy-dom',
    globals: true,
  },
})
