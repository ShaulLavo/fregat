import { expect, test, vi } from 'vitest'
import { createRoomInvitation, RoomCrypto } from '../src/room-crypto'

test('a fresh crypto instance ignores its previous instance packets within the replay lifetime', async () => {
  const { room, secret } = createRoomInvitation()
  const previous = await RoomCrypto.create(room, 'retained-peer', secret)
  vi.useFakeTimers()
  try {
    vi.setSystemTime(10_000)
    const reflected = await previous.seal('old-generation', { type: 'announce' })
    vi.setSystemTime(10_001)
    const reattached = await RoomCrypto.create(room, 'retained-peer', secret)
    await expect(reattached.open(reflected)).resolves.toBeUndefined()
    vi.setSystemTime(10_002)
    const collision = await previous.seal('old-generation', { type: 'announce' })
    await expect(reattached.open(collision)).rejects.toThrow('Duplicate peer-session')
  } finally {
    vi.useRealTimers()
  }
})

test('packets sealed in the creation millisecond are ignored on reattach', async () => {
  const { room, secret } = createRoomInvitation()
  const previous = await RoomCrypto.create(room, 'retained-peer', secret)
  vi.useFakeTimers()
  try {
    vi.setSystemTime(20_000)
    const reflected = await previous.seal('old-generation', { type: 'leave' })
    const reattached = await RoomCrypto.create(room, 'retained-peer', secret)
    await expect(reattached.open(reflected)).resolves.toBeUndefined()
  } finally {
    vi.useRealTimers()
  }
})
