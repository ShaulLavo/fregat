import { vi } from 'vitest'
import { toSse } from '../../../server/src/sse'
import { expect, test } from '../fixtures'

test('idle SSE streams send a heartbeat before the server closes the connection', async () => {
  vi.useFakeTimers()
  const source = Promise.withResolvers<string>()
  const stream = toSse(delayedEvent(source.promise), { event: () => 'message' })
  const received: unknown[] = []
  const reading = stream.next().then((frame) => received.push(frame.value))

  try {
    await vi.advanceTimersByTimeAsync(20_000)
    expect(received[0]).toMatchObject({ event: 'heartbeat', data: null })
    source.resolve('changed')
    expect((await stream.next()).value).toMatchObject({ event: 'message', data: 'changed' })
  } finally {
    source.resolve('changed')
    await reading
    await stream.return(undefined)
    vi.useRealTimers()
  }
})

async function* delayedEvent(event: Promise<string>) {
  yield await event
}
