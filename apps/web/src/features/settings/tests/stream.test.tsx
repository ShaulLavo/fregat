import { getClient } from '@/lib/client'
import type { QueryClient } from '@tanstack/react-query'
import { createTestQueryClient } from '../../../../test/render'
import { renderHook, waitFor } from '@testing-library/react'
import { providerDriverKindSchema, providerInstanceIdSchema } from '@workspace/contracts'
import { createElement, type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import * as v from 'valibot'

import { expect, test } from '../../../../test/fixtures'
import { providerQueryKeys } from '@/features/chat/utils/provider-query'
import { useSettingsProjection } from '@/features/settings/hooks/use-settings-projection'
import {
  superviseSettingsStream,
  useSettingsStream,
} from '@/features/settings/hooks/use-settings-stream'
import {
  resetSettingsIntentStore,
  submitSettingsIntent,
} from '@workspace/client-core/settings/intent-store'
import {
  refreshConfirmedSettings,
  resetSettingsSnapshotAdmission,
} from '@/features/settings/state/snapshot-admission'
import { fetchSettings, saveSettings } from '@/features/settings/utils/api'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'

function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
}

test('lands a change made by another writer in this tab’s cache', async ({ client }) => {
  expect(client).toBeDefined()
  const queryClient = createTestQueryClient()
  const stream = renderHook(() => useSettingsStream(), { wrapper: wrapper(queryClient) })

  // Stands in for the other writer: a second window, or a hand-edit to the file.
  // Either way it reaches this tab over the stream, not by polling.
  await saveSettings(
    {
      mutationId: 'stream-external-theme',
      operations: [{ key: 'workbench.colorTheme', kind: 'set', value: 'dark' }],
      target: 'user',
    },
    getClient(),
  )

  await waitFor(() => {
    const cached = queryClient.getQueryData(settingsKeys.document())
    expect(cached).toMatchObject({ values: { 'workbench.colorTheme': 'dark' } })
  })

  stream.unmount()
  resetSettingsSnapshotAdmission(queryClient)
  queryClient.clear()
})

test('first connection refetch closes the gap after the initial document GET', async ({
  controlledClient,
}) => {
  const { controller } = controlledClient
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(settingsKeys.document(), await fetchSettings(undefined, getClient()))
  await saveSettings(
    {
      mutationId: 'controlled-stream-before-first-connect',
      operations: [{ key: 'editor.fontSize', kind: 'set', value: 23 }],
      target: 'user',
    },
    getClient(),
  )
  const abort = new AbortController()
  const supervisor = superviseSettingsStream(queryClient, abort.signal)

  await controller.waitForSettingsStreamRequest(1)
  await waitFor(() => expect(controller.settingsReadCount).toBeGreaterThanOrEqual(2))
  await waitFor(() => {
    expect(queryClient.getQueryData(settingsKeys.document())).toMatchObject({
      values: { 'editor.fontSize': 23 },
    })
  })

  abort.abort()
  await supervisor
  resetSettingsSnapshotAdmission(queryClient)
  queryClient.clear()
})

test('a failed confirming refetch aborts the attempt and retries recovery', async ({
  controlledClient,
}) => {
  const { controller } = controlledClient
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(settingsKeys.document(), await fetchSettings(undefined, getClient()))
  await saveSettings(
    {
      mutationId: 'controlled-stream-before-failed-refetch',
      operations: [{ key: 'editor.fontSize', kind: 'set', value: 24 }],
      target: 'user',
    },
    getClient(),
  )
  controller.rejectNextSettingsRead({
    code: 'settings.READ_FAILED',
    message: 'Injected stream recovery failure',
    status: 503,
  })
  const abort = new AbortController()
  let backoffCount = 0
  const supervisor = superviseSettingsStream(queryClient, abort.signal, {
    wait: async () => {
      backoffCount += 1
      return true
    },
  })

  await controller.waitForSettingsStreamRequest(2)
  await waitFor(() => expect(controller.settingsReadCount).toBeGreaterThanOrEqual(3))
  await waitFor(() => {
    expect(queryClient.getQueryData(settingsKeys.document())).toMatchObject({
      values: { 'editor.fontSize': 24 },
    })
  })
  expect(backoffCount).toBeGreaterThanOrEqual(1)

  abort.abort()
  await supervisor
  resetSettingsSnapshotAdmission(queryClient)
  queryClient.clear()
})

test('refetches and reconnects a real SSE response without dropping projection', async ({
  controlledClient,
}) => {
  const { controller } = controlledClient
  const queryClient = createTestQueryClient()
  const confirmed = await fetchSettings(undefined, getClient())
  queryClient.setQueryData(settingsKeys.document(), confirmed)
  resetSettingsIntentStore()
  const pending = submitSettingsIntent(queryClient, 'user', [
    { key: 'workbench.colorTheme', kind: 'set', value: 'dark' },
  ]).entry
  const stream = renderHook(
    () => {
      useSettingsStream()
      return useSettingsProjection()
    },
    { wrapper: wrapper(queryClient) },
  )

  await saveSettings(
    {
      mutationId: 'controlled-stream-open',
      operations: [{ key: 'editor.fontSize', kind: 'set', value: 14 }],
      target: 'user',
    },
    getClient(),
  )
  await controller.waitForSettingsStreamAttempt(1)
  expect(stream.result.current?.values['workbench.colorTheme']).toBe('dark')
  expect(controller.terminateSettingsStream(1)).toBe(true)

  await controller.waitForSettingsStreamRequest(2)
  await waitFor(() => expect(controller.settingsReadCount).toBeGreaterThanOrEqual(2))
  await saveSettings(
    {
      mutationId: 'controlled-stream-reconnect',
      operations: [{ key: 'editor.fontSize', kind: 'set', value: 15 }],
      target: 'user',
    },
    getClient(),
  )
  await controller.waitForSettingsStreamAttempt(2)
  await waitFor(() => {
    expect(queryClient.getQueryData(settingsKeys.document())).toMatchObject({
      values: { 'editor.fontSize': 15 },
    })
  })
  expect(stream.result.current?.values['workbench.colorTheme']).toBe('dark')
  expect(stream.result.current?.pendingMutationIds).toEqual([pending.request.mutationId])

  stream.unmount()
  resetSettingsSnapshotAdmission(queryClient)
  resetSettingsIntentStore()
  queryClient.clear()
})

test('recovers a write made during reconnect backoff after opening the replacement stream', async ({
  controlledClient,
}) => {
  const { controller } = controlledClient
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(settingsKeys.document(), await fetchSettings(undefined, getClient()))
  const abort = new AbortController()
  const backoffStarted = deferred<void>()
  const resumeBackoff = deferred<void>()
  const supervisor = superviseSettingsStream(queryClient, abort.signal, {
    wait: async (_delayMs, signal) => {
      backoffStarted.resolve()
      await resumeBackoff.promise
      return !signal.aborted
    },
  })

  await saveSettings(
    {
      mutationId: 'controlled-stream-before-backoff',
      operations: [{ key: 'editor.fontSize', kind: 'set', value: 20 }],
      target: 'user',
    },
    getClient(),
  )
  await controller.waitForSettingsStreamAttempt(1)
  expect(controller.terminateSettingsStream(1)).toBe(true)
  await backoffStarted.promise
  await saveSettings(
    {
      mutationId: 'controlled-stream-during-backoff',
      operations: [{ key: 'editor.fontSize', kind: 'set', value: 21 }],
      target: 'user',
    },
    getClient(),
  )
  resumeBackoff.resolve()

  await controller.waitForSettingsStreamRequest(2)
  await waitFor(() => {
    expect(queryClient.getQueryData(settingsKeys.document())).toMatchObject({
      values: { 'editor.fontSize': 21 },
    })
  })

  abort.abort()
  await supervisor
  resetSettingsSnapshotAdmission(queryClient)
  queryClient.clear()
})

test('aborting reconnect backoff prevents another real SSE attempt', async ({
  controlledClient,
}) => {
  const { controller } = controlledClient
  const queryClient = createTestQueryClient()
  const abort = new AbortController()
  const backoffStarted = deferred<void>()
  const supervisor = superviseSettingsStream(queryClient, abort.signal, {
    wait: (_delayMs, signal) => {
      backoffStarted.resolve()
      if (signal.aborted) return Promise.resolve(false)

      return new Promise((resolve) => {
        signal.addEventListener('abort', () => resolve(false), { once: true })
      })
    },
  })

  await saveSettings(
    {
      mutationId: 'controlled-stream-abort',
      operations: [{ key: 'editor.fontSize', kind: 'set', value: 16 }],
      target: 'user',
    },
    getClient(),
  )
  await controller.waitForSettingsStreamAttempt(1)
  expect(controller.terminateSettingsStream(1)).toBe(true)
  await backoffStarted.promise

  abort.abort()
  await supervisor
  expect(controller.settingsStreamRequestCount).toBe(1)

  resetSettingsSnapshotAdmission(queryClient)
  queryClient.clear()
})

test('same-epoch recovery invalidates providers only when provider settings changed', async ({
  client,
}) => {
  expect(client).toBeDefined()
  const queryClient = createTestQueryClient()
  const initial = await fetchSettings(undefined, getClient())
  queryClient.setQueryData(settingsKeys.document(), initial)
  queryClient.setQueryData(providerQueryKeys.list(), { providers: [] })

  await saveSettings(
    {
      mutationId: 'stream-unrelated-recovery',
      operations: [{ key: 'editor.fontSize', kind: 'set', value: 17 }],
      target: 'user',
    },
    getClient(),
  )
  const unrelated = await refreshConfirmedSettings(queryClient)
  expect(unrelated.serverVersion.epoch).toBe(initial.serverVersion.epoch)
  expect(queryClient.getQueryState(providerQueryKeys.list())?.isInvalidated).toBe(false)

  const providerInstanceId = v.parse(providerInstanceIdSchema, 'stream-provider')
  await saveSettings(
    {
      mutationId: 'stream-provider-recovery',
      operations: [
        {
          createIfMissing: {
            driverKind: v.parse(providerDriverKindSchema, 'codex'),
          },
          enabled: true,
          kind: 'provider.setEnabled',
          providerInstanceId,
        },
      ],
      target: 'user',
    },
    getClient(),
  )
  const providerUpdate = await refreshConfirmedSettings(queryClient)
  expect(providerUpdate.serverVersion.epoch).toBe(initial.serverVersion.epoch)
  expect(queryClient.getQueryState(providerQueryKeys.list())?.isInvalidated).toBe(true)

  resetSettingsSnapshotAdmission(queryClient)
  queryClient.clear()
})

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })

  return { promise, resolve }
}
