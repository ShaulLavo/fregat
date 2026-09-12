import { treaty } from '@elysia/eden'
import type { App } from 'server/client-contract'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { afterEach, expect, test } from 'vitest'

import { settingsSnapshot } from '../../../../test/factories/settings'
import { AppProviders, createTestQueryClient, seedBootMirrorTheme } from '../../../../test/render'
import { useTheme } from '@/features/settings/hooks/use-theme'
import { getClient, activeServerOrigin, setClient, type Client } from '@/lib/client'
import { clientInstanceId, instanceHeaderName } from '@/lib/instance-id'
import {
  resetSettingsIntentStore,
  type SettingsSubmission,
} from '@workspace/client-core/settings/intent-store'
import { resetSettingsSnapshotAdmission } from '@/features/settings/state/snapshot-admission'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'

let root: Root | null = null
let restoreClient: Client | null = null

afterEach(() => {
  flushSync(() => root?.unmount())
  root = null
  if (restoreClient) setClient(restoreClient)
  restoreClient = null
  resetSettingsIntentStore()
  document.body.replaceChildren()
  document.documentElement.classList.remove('dark', 'light')
  localStorage.clear()
})

test('preview-to-pending handoff has no paint gap before final rejection', async () => {
  const failure = deferredResponse()
  restoreClient = getClient()
  setClient(controlledFailureClient(failure.response))
  seedBootMirrorTheme('light')
  resetSettingsIntentStore()
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(
    settingsKeys.document(),
    settingsSnapshot({
      userRaw: { 'workbench.colorTheme': 'light' },
      values: { 'workbench.colorTheme': 'light' },
    }),
  )
  let controls: ReturnType<typeof useTheme> | null = null
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  flushSync(() => {
    root?.render(
      <AppProviders queryClient={queryClient}>
        <ThemeProbe onRender={(value) => (controls = value)} />
      </AppProviders>,
    )
  })
  await expect.poll(() => controls).not.toBeNull()
  if (!controls) return

  const captured: { current?: SettingsSubmission } = {}
  flushSync(() => {
    controls?.previewTheme('dark')
  })
  const transitions = [rootTheme()]
  await recordNextPaint(transitions)

  flushSync(() => {
    captured.current = controls?.setTheme('dark') ?? { kind: 'noop' }
  })
  const submission = captured.current
  expect(submission?.kind).toBe('submitted')
  if (submission?.kind !== 'submitted') return

  await recordNextPaint(transitions)
  await recordNextPaint(transitions)
  expect(transitions).toEqual(['dark'])

  failure.reject()
  await expect(submission.settled).resolves.toBe('failed')
  await recordUntilTheme(transitions, 'light')
  expect(transitions).toEqual(['dark', 'light'])

  resetSettingsSnapshotAdmission(queryClient)
  queryClient.clear()
})

function ThemeProbe({
  onRender,
}: {
  readonly onRender: (value: ReturnType<typeof useTheme>) => void
}) {
  const theme = useTheme()
  onRender(theme)
  return null
}

function controlledFailureClient(response: Promise<Response>): Client {
  const fetcher = (async (input, init) => {
    const request = new Request(input, init)
    if (new URL(request.url).pathname === '/settings/write') return response

    return fetch(request)
  }) as typeof fetch

  return treaty<App>(activeServerOrigin(), {
    fetcher,
    headers: () => ({ [instanceHeaderName]: clientInstanceId() }),
  })
}

function deferredResponse() {
  let reject = () => undefined
  const response = new Promise<Response>((resolve) => {
    reject = () => {
      resolve(
        Response.json(
          { code: 'settings.WRITE_INVALID', message: 'Injected final rejection' },
          { status: 400 },
        ),
      )
    }
  })

  return { reject, response }
}

async function recordNextPaint(transitions: string[]) {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  appendTransition(transitions, rootTheme())
}

async function recordUntilTheme(transitions: string[], theme: 'dark' | 'light') {
  for (let frame = 0; frame < 10; frame += 1) {
    await recordNextPaint(transitions)
    if (rootTheme() === theme) return
  }
}

function appendTransition(transitions: string[], theme: 'dark' | 'light') {
  if (transitions.at(-1) === theme) return
  transitions.push(theme)
}

function rootTheme(): 'dark' | 'light' {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}
