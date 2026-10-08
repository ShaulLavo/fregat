import { expect, test } from 'vitest'
import type { Message } from '../src/protocol'
import { TransportRouter } from '../src/transport-router'

const message: Message = {
  version: 1,
  room: 'room',
  document: 'document',
  sender: 'remote',
  messageId: 1,
  epoch: 'epoch',
  type: 'PRESENCE',
  payload: { clock: 1, state: { name: 'remote' } },
}

test('prefers BroadcastChannel, deduplicates across adapters and disconnects only the last path', () => {
  const connected: string[] = []
  const disconnected: string[] = []
  const received: Message[] = []
  const sent: string[] = []
  const router = new TransportRouter(
    { room: 'room', document: 'document', peer: 'local' },
    {
      connect: (peer) => connected.push(peer),
      disconnect: (peer) => disconnected.push(peer),
      receive: (input) => received.push(input),
    },
  )
  router.add('remote', 'webrtc', () => sent.push('rtc'))
  router.add('remote', 'broadcast', () => sent.push('bc'))
  router.send('remote', message)
  expect(sent).toEqual(['bc'])
  router.receive('remote', message)
  router.receive('remote', structuredClone(message))
  router.receive('remote', { ...message, sender: 'forged', messageId: 2 })
  router.receive('remote', { ...message, room: 'other', messageId: 2 })
  expect(received).toHaveLength(1)
  router.remove('remote', 'webrtc')
  expect(disconnected).toEqual([])
  router.remove('remote', 'broadcast')
  expect(connected).toEqual(['remote'])
  expect(disconnected).toEqual(['remote'])
  router.add('remote', 'webrtc', () => {})
  router.receive('remote', message)
  expect(received).toHaveLength(1)
})

test('bounds rooms at eight and keeps duplicates fenced after the receive window advances', () => {
  const received: Message[] = []
  const router = new TransportRouter(
    { room: 'room', document: 'document', peer: 'local' },
    { connect: () => {}, disconnect: () => {}, receive: (input) => received.push(input) },
  )
  router.add('remote', 'webrtc', () => {})
  for (let index = 0; index < 6; index++)
    expect(router.add(`other-${index}`, 'webrtc', () => {})).toBe(true)
  expect(router.add('ninth', 'webrtc', () => {})).toBe(false)
  for (let messageId = 1; messageId <= 5000; messageId++)
    router.receive('remote', { ...message, messageId })
  router.receive('remote', message)
  router.receive('remote', { ...message, messageId: 1000 })
  expect(received).toHaveLength(5000)
})
