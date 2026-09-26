import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Shared resolution so every project reads the same `@/` paths as the app.
const alias = {
  '@': path.resolve(import.meta.dirname, './src'),
}
const reactPlugin = () => react({ compiler: true })

// The two socket-free worlds. The real-browser project lives in
// `vitest.browser.config.ts`: Vitest merges Vite-level options such as `define`
// across the projects of one config file, so keeping it here let its
// `VITE_SERVER_URL` rewrite the server URL for these projects too.
export default defineConfig({
  test: {
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
      {
        // Hooks + light component/render tests. happy-dom, not jsdom.
        plugins: [reactPlugin()],
        resolve: { alias, dedupe: ['react', 'react-dom'] },
        test: {
          name: 'dom',
          environment: './test/env/happy-dom-ssr.ts',
          include: ['src/**/*.test.tsx', 'test/**/*.test.tsx'],
          exclude: ['src/**/*.browser.tsx'],
          setupFiles: ['./test/env/msw.ts', './test/env/dom.ts'],
          // Some suites render a full settings surface - the keybinding list is
          // ~90 rows - against the real in-process server. Under a parallel
          // monorepo run that clears 5s on a cold worker, and the failure is a
          // timeout rather than an assertion, which says nothing about the code.
          testTimeout: 20_000,
        },
      },
    ],
  },
})
