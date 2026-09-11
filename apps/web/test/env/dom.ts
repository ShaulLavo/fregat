import { healthDescriptorSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { activeServerOrigin } from '@/lib/client'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { TEST_ENVIRONMENT_ID } from '../factories/chat'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'

import { createInProcessClient } from '../client'
import { installTestClient } from '../factories/client-binding'
import { makeTestServer, type TestServer } from '../server'
import './jest-dom'

// Every provider stack these tests mount reads settings through `getClient()`.
// Left at its production default that client opens a real socket to a port no
// test run listens on, so each render spammed ECONNREFUSED and silently
// exercised the settings failure path instead of the app's own behaviour. One
// real in-process server per file is the honest default; tests that need their
// own workspace still take the `client` fixture, which layers over this.
let server: TestServer | undefined
let restoreClient: (() => void) | undefined

beforeAll(async () => {
  server = await makeTestServer({ environmentId: TEST_ENVIRONMENT_ID })
  const client = createInProcessClient(server)
  restoreClient = installTestClient(client)
  useEnvironmentsStore
    .getState()
    .recordDescriptor(
      activeServerOrigin(),
      v.parse(healthDescriptorSchema, (await client.health.get()).data),
    )
})

afterAll(async () => {
  restoreClient?.()
  restoreClient = undefined
  await server?.cleanup()
  server = undefined
})

// Unmount anything React Testing Library rendered between tests so the happy-dom
// document never leaks state across cases.
afterEach(() => {
  cleanup()
})
