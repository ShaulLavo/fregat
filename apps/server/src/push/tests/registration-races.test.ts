import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { createMetadataDatabase } from '../../db/client'
import { migratePlatformDatabase } from '../../db/migrations'
import { SettingsStore } from '../../settings/store'
import { testSettingsOptions } from '../../settings/testing'
import { createPushSubscriber } from '../../../test/factories/push-subscriber'
import { PushService } from '../service'
import type { PushFetcher } from '../delivery'

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
const endpoint = 'https://fcm.googleapis.com/fcm/send/race'
const notice = { title: 'Done', body: 'Turn complete', path: '', tag: 'race' }

async function fixture(fetcher: PushFetcher) {
  const root = await mkdtemp(path.join(tmpdir(), 'push-races-'))
  const database = createMetadataDatabase({ databasePath: ':memory:' })
  migratePlatformDatabase(database.db)
  const settings = new SettingsStore(testSettingsOptions(root))
  cleanups.push(async () => {
    settings.close()
    database.close()
    await rm(root, { recursive: true, force: true })
  })
  const service = new PushService({ database: database.db, settings, fetcher })
  const registration = { label: 'Phone', subscription: createPushSubscriber(endpoint).subscription }
  const device = await service.register(registration, null)
  return { service, registration, device }
}

test('removal while VAPID keys load prevents delivery from an earlier snapshot', async () => {
  let sent = 0
  const { service, device } = await fixture(async () => {
    sent++
    return new Response(null, { status: 201 })
  })
  const pending = service.broadcast(notice, { ttlSeconds: 300 })
  service.remove(device.id)
  await pending
  expect(sent).toBe(0)
})

test('an expired send cannot remove a newer registration with the same endpoint and keys', async () => {
  const started = Promise.withResolvers<void>()
  const answer = Promise.withResolvers<Response>()
  const { service, registration, device } = await fixture(async () => {
    started.resolve()
    return answer.promise
  })
  const pending = service.broadcast(notice, { ttlSeconds: 300 })
  await started.promise
  await service.register(registration, null)
  answer.resolve(new Response(null, { status: 410 }))
  await pending
  expect((await service.list()).devices.map((row) => row.id)).toEqual([device.id])
})
