import { defineConfig } from 'vitest/config'
import { gitFixtureEnv } from './src/testing/git-identity'

// Bun-native server: must run under the Bun runtime (`bun --bun vitest`) so
// bun:sqlite and Bun.spawn resolve. Tests drive the real app via `app.handle`
// and spawn real processes, so they run in the Node environment with no DOM.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    env: gitFixtureEnv,
    // The suite spawns real processes (git, PTYs, LSP servers); cold spawns
    // under parallel load blow Vitest's 5s default. Server project only —
    // web and packages keep the default. Raised from 15s after the read-model
    // hydration test — which dispatches several thousand events one at a time —
    // took 16s on a machine that was busy, twice. A timeout that only holds on
    // an idle machine is a flake generator in CI.
    testTimeout: 30_000,
  },
})
