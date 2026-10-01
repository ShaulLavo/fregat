import { playwright } from '@vitest/browser-playwright'
import { defineConfig, type Plugin } from 'vitest/config'
import type { BrowserCommand } from 'vitest/node'
import { browserTestResponses } from '../../scripts/browser-test-responses.ts'
import { workspaceRoot } from '../../scripts/workspace-root'

// Outages live in the dev server, shared by every test file: a Playwright route resolves before
// the test frame's loader intercepts with it, so a request sent right after blocking could load.
const blocked = new Set<string>()
const held = new Map<string, { gate: Promise<void>; release: () => void }>()
const heldGate = (url: string) => {
  for (const [pattern, { gate }] of held) if (url.includes(pattern)) return gate
  return undefined
}

const grammarOutages: Plugin = {
  name: 'highlighting-test:grammar-outages',
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const url = request.url ?? ''
      if ([...blocked].some((pattern) => url.includes(pattern))) {
        response.statusCode = 503
        response.end()
        return
      }
      const gate = heldGate(url)
      if (!gate) return next()
      void gate.then(() => next())
    })
  },
}

// Fails a third-party grammar chunk the way an outage would, so tests reach real acquisition errors.
const blockRequests: BrowserCommand<[pattern: string]> = (_context, pattern) => {
  blocked.add(pattern)
}
const unblockRequests: BrowserCommand<[pattern: string]> = (_context, pattern) => {
  blocked.delete(pattern)
}
// Holds a grammar chunk until the test releases it, so work can be caught mid-acquisition.
const holdRequests: BrowserCommand<[pattern: string]> = (_context, pattern) => {
  let release = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  held.set(pattern, { gate, release })
}
const releaseRequests: BrowserCommand<[pattern: string]> = (_context, pattern) => {
  held.get(pattern)?.release()
  held.delete(pattern)
}
const commands = { blockRequests, unblockRequests, holdRequests, releaseRequests }

export default defineConfig({
  server: { fs: { allow: [workspaceRoot] } },
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['test/**/*.test.ts'],
          exclude: ['test/**/*.browser.test.ts'],
        },
      },
      {
        // The real Shiki worker and grammars.
        optimizeDeps: {
          include: [
            '@singapore-editor/core > @shikijs/engine-oniguruma',
            '@singapore-editor/core > @shikijs/engine-oniguruma/wasm-inlined',
            'shiki/core',
          ],
        },
        plugins: [browserTestResponses(), grammarOutages],
        test: {
          name: 'browser',
          include: ['test/**/*.browser.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            commands,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
      {
        // Workers, WebAssembly and transfers in the other engines; run with `test:engines`.
        test: {
          name: 'engines',
          include: ['test/service.browser.test.ts', 'test/structure.browser.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [
              { browser: 'firefox', name: 'engines-firefox' },
              { browser: 'webkit', name: 'engines-webkit' },
            ],
          },
        },
      },
    ],
  },
})
