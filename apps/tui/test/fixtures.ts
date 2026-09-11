import { test as base } from 'vitest'
import { healthDescriptorSchema } from '@workspace/contracts'
import {
  initializeObservabilityRuntime,
  resetObservabilityForTests,
} from '@workspace/observability'
import * as v from 'valibot'
import { openFileStorage, type FileStorage } from '@/storage/files'

import { createInProcessClient, createInProcessFetcher } from './client'
import { makeTestServer, type TestServer } from './server'

type Fixtures = {
  server: TestServer
  client: ReturnType<typeof createInProcessClient>
  fetcher: ReturnType<typeof createInProcessFetcher>
  storage: FileStorage
  storageWarnings: Record<string, unknown>[]
}

export const test = base.extend<Fixtures>({
  // Vitest requires destructuring to discover fixture dependencies.
  // eslint-disable-next-line no-empty-pattern
  server: async ({}, provide) => {
    const server = await makeTestServer()
    try {
      await provide(server)
    } finally {
      await server.cleanup()
    }
  },
  client: async ({ server }, provide) => {
    await provide(createInProcessClient(server))
  },
  fetcher: async (
    { server }: Pick<Fixtures, 'server'>,
    provide: (fetcher: Fixtures['fetcher']) => Promise<void>,
  ) => {
    await provide(createInProcessFetcher(server))
  },
  storage: async ({ server, client }, provide) => {
    const descriptor = v.parse(healthDescriptorSchema, (await client.health.get()).data)
    const storage = await openFileStorage(`${server.root}/storage`, descriptor.environmentId)
    try {
      await provide(storage)
    } finally {
      storage.close()
    }
  },
  storageWarnings: async ({ server }, provide) => {
    const events: Record<string, unknown>[] = []
    initializeObservabilityRuntime({
      source: 'tui',
      env: {
        NODE_ENV: 'test',
        OBSERVABILITY_ENABLED: 'true',
        OBSERVABILITY_CONSOLE: 'false',
        OBSERVABILITY_DIR: `${server.root}/logs`,
      },
      shouldPersistEvent: ({ event }) => {
        if (event.action === 'tui.storage.read') events.push(event)
        return false
      },
    })
    try {
      await provide(events)
    } finally {
      await resetObservabilityForTests()
    }
  },
})

export { expect } from 'vitest'
