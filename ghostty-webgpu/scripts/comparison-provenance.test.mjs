import assert from 'node:assert/strict'
import test from 'node:test'

function cdpBoundary() {
  const calls = []
  return {
    calls,
    session: {
      async send(method) {
        calls.push(method)
        if (method === 'Browser.getBrowserCommandLine') {
          throw new TypeError('Command line not returned because --enable-automation not set.')
        }
        assert.equal(method, 'Browser.getVersion')
        return { product: 'Chrome/154.0.8037.93', revision: 'synthetic-revision' }
      },
    },
  }
}

test('known-good CDP boundary exposes the actual browser build', async () => {
  const boundary = cdpBoundary()
  assert.equal((await boundary.session.send('Browser.getVersion')).product, 'Chrome/154.0.8037.93')
  assert.deepEqual(boundary.calls, ['Browser.getVersion'])
})

test('legacy launch provenance reads the actual command line without automation', async () => {
  const boundary = cdpBoundary()
  const arguments_ = (await boundary.session.send('Browser.getBrowserCommandLine')).arguments
  assert(Array.isArray(arguments_))
})
