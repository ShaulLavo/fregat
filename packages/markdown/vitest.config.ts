import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        // The derivation is pure and parses real grammars, so it wants node, not a DOM.
        test: {
          name: 'node',
          environment: 'node',
          include: ['test/replacements.test.ts', 'test/authoring.test.ts'],
        },
      },
      {
        test: { name: 'dom', environment: 'happy-dom', include: ['test/preview.test.ts'] },
      },
    ],
  },
})
