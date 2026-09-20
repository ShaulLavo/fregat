import { expect, test } from '../../../test/fixtures'
import { adaptWebSocket } from '../../../../server/src/utils/websocket'

test('adapts socket identity without losing method receivers or binary payloads', () => {
  const raw = {}
  const sent: (string | Uint8Array)[] = []
  const closures: [number | undefined, string | undefined][] = []
  const socket = {
    raw,
    data: { query: { root: 'workspace' } },
    send(message: string | Uint8Array) {
      expect(this).toBe(socket)
      sent.push(message)
    },
    close(code?: number, reason?: string) {
      expect(this).toBe(socket)
      closures.push([code, reason])
    },
  }
  const adapted = adaptWebSocket(socket)!
  const bytes = new Uint8Array([0, 255])
  adapted.send('request')
  adapted.send(bytes)
  adapted.close(1000, 'finished')
  expect(adapted.key).toBe(raw)
  expect(adapted.data).toBe(socket.data)
  expect(sent).toEqual(['request', bytes])
  expect(closures).toEqual([[1000, 'finished']])
})

test('requires send and permits sockets without a close method', () => {
  expect(adaptWebSocket(null)).toBeNull()
  expect(adaptWebSocket({ send: 'invalid' })).toBeNull()
  const socket = { send: () => undefined }
  const adapted = adaptWebSocket(socket)!
  expect(adapted.key).toBe(socket)
  expect(adapted.close()).toBeUndefined()
})
