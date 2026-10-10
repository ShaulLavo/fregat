import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'cost-experiment',
    environment: 'node',
    execArgv: ['--expose-gc'],
    include: [
      'bench/detector.test.ts',
      'bench/profile.test.ts',
      'bench/candidates.test.ts',
      'bench/tail.test.ts',
      'bench/cursor.test.ts',
    ],
    testTimeout: 180_000,
    fileParallelism: false,
  },
})
