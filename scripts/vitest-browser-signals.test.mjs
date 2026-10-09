import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { test } from 'vitest'

const editor = createRequire(new URL('../editor/packages/editor/package.json', import.meta.url))
const providerUrl = pathToFileURL(editor.resolve('@vitest/browser-playwright')).href

test('Playwright providers share and release SIGTERM trace cleanup', () => {
  // Deliver a real signal in a child so Vitest's own termination handler stays untouched.
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict'
    import { setTimeout } from 'node:timers/promises'
    import { PlaywrightBrowserProvider } from ${JSON.stringify(providerUrl)}

    const project = {
      config: { browser: { name: 'chromium' } },
      browser: { registerCommand() {} },
    }
    const initial = process.listenerCount('SIGTERM')
    const providers = Array.from({ length: 12 }, () => new PlaywrightBrowserProvider(project, {}))
    assert.equal(process.listenerCount('SIGTERM'), initial + 1)

    const stopped = []
    for (const [index, provider] of providers.entries()) {
      provider.browser = { close: async () => {} }
      provider.contexts.set('session', {
        tracing: { stopChunk: async ({ path }) => { stopped.push(path) } },
        close: async () => {},
      })
      provider.pendingTraces.set('trace-' + index, 'session')
    }
    process.kill(process.pid, 'SIGTERM')
    await setTimeout(50)
    assert.deepEqual(stopped.sort(), providers.map((_, index) => 'trace-' + index).sort())

    await providers[0].close()
    assert.equal(process.listenerCount('SIGTERM'), initial + 1)
    await Promise.all(providers.slice(1).map(provider => provider.close()))
    assert.equal(process.listenerCount('SIGTERM'), initial)

    const reopened = new PlaywrightBrowserProvider(project, {})
    assert.equal(process.listenerCount('SIGTERM'), initial + 1)
    await reopened.close()
    assert.equal(process.listenerCount('SIGTERM'), initial)
    console.log('12 traces stopped; shared listener removed and reusable')
  `,
    ],
    { encoding: 'utf8', timeout: 10_000 },
  )

  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.signal, null)
  assert.doesNotMatch(result.stderr, /MaxListenersExceededWarning/)
  assert.match(result.stdout, /12 traces stopped; shared listener removed and reusable/)
})
