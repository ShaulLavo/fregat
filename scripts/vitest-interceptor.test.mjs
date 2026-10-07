import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { test } from 'vitest'

const workspace = createRequire(new URL('../ghostty-webgpu/package.json', import.meta.url))
const provider = createRequire(workspace.resolve('@vitest/browser-playwright'))
const browser = createRequire(provider.resolve('@vitest/browser'))
const { interceptorPlugin } = await import(
  pathToFileURL(browser.resolve('@vitest/mocker/node')).href
)

test('an explicitly disabled interceptor exposes only its environment hooks', () => {
  const plugin = interceptorPlugin({ registerWebSocketEvents: false })
  assert.equal(plugin.configureServer, undefined)
  assert.equal(typeof plugin.load.handler, 'function')
  assert.equal(typeof plugin.transform.handler, 'function')
})

test('the default interceptor registers its standalone websocket handlers', () => {
  const plugin = interceptorPlugin()
  const registered = []
  plugin.configureServer({ ws: { on: (event) => registered.push(event) } })
  assert.deepEqual(registered, [
    'vitest:interceptor:register',
    'vitest:interceptor:delete',
    'vitest:interceptor:invalidate',
  ])
})
