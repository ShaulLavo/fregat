import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from '../msw/server'
import { stopRequestOwners } from './request-lifecycle'

// The `'error'` string strategy prints and rejects the *request*, not the test: an
// operation that treats a failed background fetch as ordinary (a retrying query, a
// best-effort reconnect) swallows that rejection, and the stderr line is all that is
// left, easy to scroll past in CI. A function strategy sees every unhandled frame
// (HTTP and WebSocket alike, since both route through the same network layer) before
// MSW decides what to do with it, so recording one here and failing in `afterEach`
// attributes the failure to the test that caused it regardless of how the app itself
// reacts. Throwing from the handler still blocks the real network call, matching
// `'error'`'s behavior — nothing here is allowed to reach an actual socket.
let unhandled: string[] = []

beforeAll(() =>
  server.listen({
    onUnhandledRequest: (request) => {
      const description = `${request.method} ${request.url}`
      unhandled.push(description)
      throw new Error(`[MSW] Unhandled request: ${description}`)
    },
  }),
)
afterEach(({ task }) => {
  stopRequestOwners(task)
  server.resetHandlers()
  const seen = unhandled
  unhandled = []
  if (seen.length === 0) return
  throw new Error(
    `Unhandled request(s) reached MSW. Route them through the real server fixture ` +
      `(test/fixtures.ts) or add a handler in test/msw/handlers.ts:\n` +
      seen.map((line) => `  ${line}`).join('\n'),
  )
})
afterAll(() => server.close())
