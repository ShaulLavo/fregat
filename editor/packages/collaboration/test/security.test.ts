import { expect, test } from 'vitest'
import { createRoomInvitation, RoomCrypto } from '../src/room-crypto'

test('authenticates duplicate peer-session generations and fails loudly', async () => {
  const { room, secret } = createRoomInvitation()
  const tab = await RoomCrypto.create(room, 'duplicated-peer', secret)
  const duplicate = await RoomCrypto.create(room, 'duplicated-peer', secret)
  const own = await tab.seal('own-generation', { type: 'announce' })
  expect(await tab.open(own)).toBeUndefined()
  const foreign = await duplicate.seal('foreign-generation', { type: 'announce' })
  expect(await tab.open({ ...foreign, ciphertext: '!invalid!' })).toBeUndefined()
  await expect(tab.open(foreign)).rejects.toThrow('Duplicate peer-session')
})
