import { expect, test } from 'vitest'
import { CdpClient } from '../cdp'

function fixture() {
  let input!: ReadableStreamDefaultController<Uint8Array>
  const writes: Record<string, unknown>[] = []
  let closes = 0
  const client = new CdpClient({
    input: new ReadableStream({
      start: (controller) => {
        input = controller
      },
    }),
    write: async (bytes) => {
      writes.push(JSON.parse(new TextDecoder().decode(bytes).slice(0, -1)))
    },
    close: () => {
      closes++
    },
  })
  return {
    client,
    writes,
    send: (value: string) => input.enqueue(new TextEncoder().encode(value)),
    sendBytes: (value: Uint8Array) => input.enqueue(value),
    eof: () => input.close(),
    closes: () => closes,
  }
}

test('NUL framing handles fragmented UTF-8 and multiple messages, requests correlate out of order', async () => {
  const f = fixture()
  const first = f.client.request('First')
  const second = f.client.request('Second', { value: true }, 'session')
  await Bun.sleep(0)
  expect(f.writes[1]).toMatchObject({ id: 2, method: 'Second', sessionId: 'session' })
  f.send('{"id":2,"result":{"text":"hello"}}\0{"id":1,')
  f.send('"result":{"ok":true}}\0')
  expect(await first).toEqual({ ok: true })
  expect(await second).toEqual({ text: 'hello' })
  f.client.close()
  expect(f.closes()).toBe(1)
})
test('events include flattened session id and unsubscribe removes subscriber', async () => {
  const f = fixture()
  const events: unknown[] = []
  const off = f.client.on('Page.loadEventFired', (event) => events.push(event))
  f.send('{"method":"Page.loadEventFired","params":{"timestamp":1},"sessionId":"page"}\0')
  await Promise.resolve()
  expect(events).toEqual([
    { method: 'Page.loadEventFired', params: { timestamp: 1 }, sessionId: 'page' },
  ])
  off()
  f.client.close()
})
test('protocol errors reject only their request and future requests still work', async () => {
  const f = fixture()
  const failure = expect(f.client.request('Bad')).rejects.toThrow('control connection')
  f.send('{"id":1,"error":{"code":-1,"message":"private external content"}}\0')
  await failure
  const next = f.client.request('Good')
  f.send('{"id":2,"result":{}}\0')
  await expect(next).resolves.toEqual({})
  f.client.close()
})
test.each(['oops\0', '[]\0', '{"method":1}\0', '{"method":"Event","params":[]}\0'])(
  'malformed frame closes pending requests %s',
  async (frame) => {
    const f = fixture()
    const pending = expect(f.client.request('Wait')).rejects.toThrow('control connection')
    f.send(frame)
    await pending
    await f.client.done
    expect(f.closes()).toBe(1)
  },
)
test('EOF and explicit close reject pending, idempotently close and reject further requests', async () => {
  const f = fixture()
  const pending = expect(f.client.request('Wait')).rejects.toThrow('control connection')
  f.eof()
  await pending
  f.client.close()
  expect(f.closes()).toBe(1)
  await expect(f.client.request('Closed')).rejects.toThrow('control connection')
})
test('bounded request timeout removes pending request', async () => {
  const f = fixture()
  await expect(f.client.request('Wait', {}, undefined, 5)).rejects.toThrow('control connection')
  f.client.close()
})
test('write failure closes transport', async () => {
  const client = new CdpClient({
    input: new ReadableStream(),
    write: async () => {
      throw 'fixture write failure'
    },
    close: () => {},
  })
  await expect(client.request('Wait')).rejects.toBe('fixture write failure')
})

test('serialized writes preserve framing when the first pipe write is backpressured', async () => {
  let input!: ReadableStreamDefaultController<Uint8Array>
  const blocked = Promise.withResolvers<void>()
  const writes: number[] = []
  const client = new CdpClient({
    input: new ReadableStream({
      start: (controller) => {
        input = controller
      },
    }),
    write: async (bytes) => {
      const message = JSON.parse(new TextDecoder().decode(bytes).slice(0, -1))
      writes.push(message.id)
      if (message.id === 1) await blocked.promise
    },
    close: () => {},
  })
  const first = client.request('First')
  const second = client.request('Second')
  await Promise.resolve()
  expect(writes).toEqual([1])
  blocked.resolve()
  await Bun.sleep(0)
  expect(writes).toEqual([1, 2])
  input.enqueue(new TextEncoder().encode('{"id":1,"result":{}}\0{"id":2,"result":{}}\0'))
  await Promise.all([first, second])
  client.close()
})

test('multibyte UTF-8 split inside a character survives pipe chunk boundaries', async () => {
  const f = fixture()
  const request = f.client.request('Unicode')
  const bytes = new TextEncoder().encode('{"id":1,"result":{"text":"雪"}}\0')
  const split = bytes.indexOf(0xe9) + 1
  f.sendBytes(bytes.subarray(0, split))
  f.sendBytes(bytes.subarray(split, split + 1))
  f.sendBytes(bytes.subarray(split + 1))
  await expect(request).resolves.toEqual({ text: '雪' })
  f.client.close()
})

test('disconnect publishes the original failure even without a pending request', async () => {
  const f = fixture()
  const reason = { internal: { reason: 'startup-limit' } }
  f.client.close(reason)
  expect(await f.client.disconnected).toBe(reason)
  f.client.close()
  expect(await f.client.disconnected).toBe(reason)
  expect(f.closes()).toBe(1)
})
