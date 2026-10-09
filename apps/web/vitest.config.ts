import path from 'node:path'
import react from '@vitejs/plugin-react'
import { gitFixtureEnv } from 'server/testing/git-identity'
import type { PluginOption } from 'vite'
import { defineConfig } from 'vitest/config'
import { compilerPlugin } from './test/compiler-plugin'
import DurationSequencer from './test/shard-sequencer.ts'

// Shared resolution so every project reads the same `@/` paths as the app.
const alias = {
  '@': path.resolve(import.meta.dirname, './src'),
}
const reactPlugin = () => react({ compiler: true })
const compilerPlugins: PluginOption[] = [compilerPlugin()]

export const domProject = {
  plugins: [reactPlugin()],
  resolve: { alias, dedupe: ['react', 'react-dom'] },
  test: {
    name: 'dom',
    environment: './test/env/happy-dom-ssr.ts',
    include: ['src/**/*.test.tsx', 'test/**/*.test.tsx'],
    exclude: ['src/**/*.browser.tsx', '**/*.compiler.test.tsx'],
    setupFiles: ['./test/env/msw.ts', './test/env/dom.ts'],
    // Full settings surfaces read real server state and can clear 5s on a cold worker.
    testTimeout: 20_000,
  },
}

export const compilerProject = {
  ...domProject,
  plugins: compilerPlugins.concat(domProject.plugins),
  test: {
    ...domProject.test,
    name: 'compiler',
    include: ['src/**/*.compiler.test.tsx', 'test/**/*.compiler.test.tsx'],
    exclude: ['src/**/*.browser.tsx'],
  },
}

// Socket-free projects. The real-browser project lives in
// `vitest.browser.config.ts`: Vitest merges Vite-level options such as `define`
// across the projects of one config file, so keeping it here let its
// `VITE_SERVER_URL` rewrite the server URL for these projects too.
export default defineConfig({
  test: {
    env: gitFixtureEnv,
    // CI shards by recorded file durations; refresh them with `bun run test:durations`.
    sequence: { sequencer: DurationSequencer },
    projects: [
      {
        // Pure logic + anything that talks to the in-process server. No DOM.
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
          setupFiles: ['./test/env/msw.ts'],
        },
      },
      domProject,
      compilerProject,
    ],
  },
})
