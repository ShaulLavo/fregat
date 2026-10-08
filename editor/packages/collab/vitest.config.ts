import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    projects: [
      { extends: true, test: { name: 'reference', provide: { engine: 'reference' } } },
      { extends: true, test: { name: 'textbuffer', provide: { engine: 'textbuffer' } } },
    ],
  },
})
