import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

import { expect, test } from '../../../../test/fixtures'
import { settingsSnapshot } from '../../../../test/factories/settings'
import { AppProviders, createTestQueryClient, seedBootMirrorTheme } from '../../../../test/render'
import { useTheme } from '@/features/settings/hooks/use-theme'
import {
  resetSettingsIntentStore,
  type SettingsSubmission,
} from '@workspace/client-core/settings/intent-store'
import { resetSettingsSnapshotAdmission } from '@/features/settings/state/snapshot-admission'
import { readSettingsMirror } from '@/lib/settings-boot-mirror'
import { dismissSaveError } from '@/features/settings/utils/notify-save-error'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'

test('submitted theme intent hands preview to projection and updates boot mirror only after ack', async ({
  client,
}) => {
  expect(client).toBeDefined()
  seedBootMirrorTheme('light')
  resetSettingsIntentStore()
  const queryClient = confirmedLightQueryClient()
  const theme = renderHook(() => useTheme(), { wrapper: wrapper(queryClient) })
  const captured: { current?: SettingsSubmission } = {}

  act(() => {
    theme.result.current.previewTheme('dark')
    captured.current = theme.result.current.setTheme('dark')
    theme.result.current.clearThemePreview()
  })

  const submission = captured.current
  expect(submission?.kind).toBe('submitted')
  expect(document.documentElement.classList.contains('dark')).toBe(true)
  expect(readSettingsMirror()['workbench.colorTheme']).toBe('light')
  if (submission?.kind !== 'submitted') return

  await expect(submission.settled).resolves.toBe('acknowledged')
  await waitFor(() => {
    expect(readSettingsMirror()['workbench.colorTheme']).toBe('dark')
    expect(theme.result.current.theme).toBe('dark')
  })

  theme.unmount()
  resetSettingsSnapshotAdmission(queryClient)
  resetSettingsIntentStore()
  queryClient.clear()
})

test('final rejection removes the matching handoff without an intermediate theme bounce', async ({
  controlledClient,
}) => {
  controlledClient.controller.rejectNextSettingsWrite({
    code: 'settings.WRITE_INVALID',
    message: 'Injected final rejection',
    status: 400,
  })
  seedBootMirrorTheme('light')
  resetSettingsIntentStore()
  const queryClient = confirmedLightQueryClient()
  const theme = renderHook(() => useTheme(), { wrapper: wrapper(queryClient) })
  const captured: { current?: SettingsSubmission } = {}

  act(() => {
    theme.result.current.previewTheme('dark')
    captured.current = theme.result.current.setTheme('dark')
  })

  const submission = captured.current
  expect(submission?.kind).toBe('submitted')
  expect(document.documentElement.classList.contains('dark')).toBe(true)
  if (submission?.kind !== 'submitted') return

  await expect(submission.settled).resolves.toBe('failed')
  await waitFor(() => {
    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(theme.result.current.theme).toBe('light')
  })

  dismissSaveError(submission.mutationId)
  theme.unmount()
  resetSettingsSnapshotAdmission(queryClient)
  resetSettingsIntentStore()
  queryClient.clear()
})

function confirmedLightQueryClient() {
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(
    settingsKeys.document(),
    settingsSnapshot({
      userRaw: { 'workbench.colorTheme': 'light' },
      values: { 'workbench.colorTheme': 'light' },
    }),
  )
  return queryClient
}

function wrapper(queryClient: ReturnType<typeof createTestQueryClient>) {
  return ({ children }: { readonly children: ReactNode }) => (
    <AppProviders queryClient={queryClient}>{children}</AppProviders>
  )
}
