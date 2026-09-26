import { healthDescriptorSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { activeServerOrigin } from '@/lib/client'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { TEST_ENVIRONMENT_ID } from '../factories/chat'
import { cleanup } from '@testing-library/react'
import { toast } from 'sonner'
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'

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

/** sonner removes a closing toast this long later, on a timer nothing clears. */
const TOAST_REMOVAL_MS = 200
let toastsBefore = new Set<string | number>()

beforeEach(() => {
  toastsBefore = new Set(toast.getHistory().map((shown) => shown.id))
})

// Unmount anything React Testing Library rendered between tests so the happy-dom
// document never leaks state across cases. A test that showed a toast also waits out
// sonner's removal timer: fired after the environment is torn down, its setState reads
// `window` and fails the whole run.
afterEach(async () => {
  cleanup()
  if (!toast.getHistory().some((shown) => !toastsBefore.has(shown.id))) return
  await new Promise((resolve) => setTimeout(resolve, TOAST_REMOVAL_MS + 20))
})
