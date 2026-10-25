import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    server: {
      deps: {
        inline: ['@singapore-editor/diff', '@singapore-editor/core'],
      },
    },
  },
})
