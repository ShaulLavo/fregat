import { defineConfig } from 'vitest/config'

// Scoped to src: the Hutch devkit projection under .hutch/ carries Electrobun's
// own *.test.ts files, which the default glob would otherwise pick up.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
})
