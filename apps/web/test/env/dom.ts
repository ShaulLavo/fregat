import { resetSettingsIntentStore } from '@workspace/client-core/settings/intent-store'
import { resetBootAppearance } from '@/lib/settings-boot-mirror'
import { removeHtmlBootstrap } from '../factories/html-bootstrap'
import { healthDescriptorSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { activeServerOrigin } from '@/lib/client'
// NOT-PORTABLE: Needs build:workspaces; highlighting exports only generated dist files.
import { disposeHighlightingService } from '@/lib/highlighting/state/service'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { TEST_ENVIRONMENT_ID } from '../factories/chat'
import { act, cleanup } from '@testing-library/react'
import { toast } from 'sonner'
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'

import { createInProcessClient, installInProcessSocketBridge } from '../client'
import { installTestClient } from '../factories/client-binding'
import { makeTestServer, type TestServer } from '../server'
import { cleanupObservation } from './cleanup-observation'
import './jest-dom'
import './workspace-cache'

// Every provider stack these tests mount reads settings through `getClient()`.
// Left at its production default that client opens a real socket to a port no
// test run listens on, so each render spammed ECONNREFUSED and silently
// exercised the settings failure path instead of the app's own behaviour. One
// real in-process server per file is the honest default; tests that need their
// own workspace still take the `client` fixture, which layers over this.
let server: TestServer | undefined
let restoreClient: (() => void) | undefined
let restoreSocketBridge: (() => void) | undefined

beforeAll(async () => {
  server = await makeTestServer({ environmentId: TEST_ENVIRONMENT_ID })
  const client = createInProcessClient(server)
  restoreClient = installTestClient(client)
  restoreSocketBridge = installInProcessSocketBridge(server)
  useEnvironmentsStore
    .getState()
    .recordDescriptor(
      activeServerOrigin(),
      v.parse(healthDescriptorSchema, (await client.health.get()).data),
    )
})

afterAll(async () => {
  const observation = cleanupObservation(server?.app)
  observation.point('bridge', 'before', restoreSocketBridge ? 'available' : 'absent')
  restoreSocketBridge?.()
  restoreSocketBridge = undefined
  observation.point('bridge', 'after', 'absent')
  observation.point('client', 'before', restoreClient ? 'available' : 'absent')
  restoreClient?.()
  restoreClient = undefined
  observation.point('client', 'after', 'absent')
  observation.point('server', 'before', server ? 'available' : 'absent')
  await server?.cleanup()
  server = undefined
  observation.point('server', 'after', 'absent')
})

/** sonner removes a closing toast this long later, on a timer nothing clears. */
const TOAST_REMOVAL_MS = 200
let toastsBefore = new Set<string | number>()

beforeEach(() => {
  resetBootAppearance()
  removeHtmlBootstrap()
  toastsBefore = new Set(toast.getHistory().map((shown) => shown.id))
})

// Flush dismissal frames while the Toaster is mounted, then drain the removal timers
// before environment teardown: their uncancelled setState callbacks still read `window`.
afterEach(async () => {
  const showedToast = toast.getHistory().some((shown) => !toastsBefore.has(shown.id))
  if (showedToast) {
    await act(async () => {
      toast.dismiss()
      // Targeted dismissals already queued by the test need two frames to reach deleteToast.
      await new Promise(requestAnimationFrame)
      await new Promise(requestAnimationFrame)
    })
  }
  cleanup()
  // Optimistic UI can finish a test while a settings write still owns diagnostic timers.
  resetSettingsIntentStore()
  resetBootAppearance()
  removeHtmlBootstrap()
  // Unmounted diff views hand their parse to the shared service; the next test starts empty.
  await disposeHighlightingService()
  if (showedToast) await new Promise((resolve) => setTimeout(resolve, TOAST_REMOVAL_MS + 20))
})
