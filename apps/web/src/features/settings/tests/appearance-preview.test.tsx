import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { NERD_SYMBOLS_FONT } from '@workspace/contracts'
import { fontQueryOptions } from '@/lib/fonts/state/queries'

import { expect, test } from '../../../../test/fixtures'
import { settingsSnapshot } from '../../../../test/factories/settings'
import {
  AppProviders,
  createTestQueryClient,
  renderWithProviders,
  seedBootMirrorTheme,
} from '../../../../test/render'
import { useTheme } from '@/features/settings/hooks/use-theme'
import { useSettingsIntentStore } from '@/features/settings/state/intent-store'
import { resetSettingsIntentStore } from '@workspace/client-core/settings/intent-store'
import { resetSettingsSnapshotAdmission } from '@/features/settings/state/snapshot-admission'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'

test('theme preview is transient and writes no settings intent', () => {
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(
    settingsKeys.document(),
    settingsSnapshot({
      userRaw: { 'workbench.colorTheme': 'light' },
      values: { 'workbench.colorTheme': 'light' },
    }),
  )
  resetSettingsIntentStore()
  const theme = renderHook(() => useTheme(), { wrapper: wrapper(queryClient) })

  act(() => theme.result.current.previewTheme('dark'))
  expect(document.documentElement.classList.contains('dark')).toBe(true)
  expect(theme.result.current.theme).toBe('light')
  expect(useSettingsIntentStore.getState().active).toEqual([])

  act(() => theme.result.current.clearThemePreview())
  expect(document.documentElement.classList.contains('light')).toBe(true)
  expect(useSettingsIntentStore.getState().active).toEqual([])

  theme.unmount()
  resetSettingsSnapshotAdmission(queryClient)
  resetSettingsIntentStore()
  queryClient.clear()
})

test('committing the effective theme is a noop that clears hover preview', () => {
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(
    settingsKeys.document(),
    settingsSnapshot({
      userRaw: { 'workbench.colorTheme': 'light' },
      values: { 'workbench.colorTheme': 'light' },
    }),
  )
  resetSettingsIntentStore()
  const theme = renderHook(() => useTheme(), { wrapper: wrapper(queryClient) })

  act(() => theme.result.current.previewTheme('dark'))
  let submission
  act(() => {
    submission = theme.result.current.setTheme('light')
  })

  expect(submission).toEqual({ kind: 'noop' })
  expect(document.documentElement.classList.contains('light')).toBe(true)
  expect(useSettingsIntentStore.getState().active).toEqual([])

  theme.unmount()
  resetSettingsSnapshotAdmission(queryClient)
  resetSettingsIntentStore()
  queryClient.clear()
})

test('before confirmed settings arrive, the provider keeps the seeded boot theme', () => {
  const queryClient = createTestQueryClient()
  seedBootMirrorTheme('dark')
  const theme = renderHook(() => useTheme(), { wrapper: wrapper(queryClient) })

  expect(theme.result.current.theme).toBe('dark')
  expect(theme.result.current.resolvedTheme).toBe('dark')
  expect(document.documentElement.classList.contains('dark')).toBe(true)

  theme.unmount()
  resetSettingsSnapshotAdmission(queryClient)
  queryClient.clear()
})

test('appearance stays busy until confirmed settings and fonts settle', async ({ client }) => {
  expect(client).toBeDefined()
  const rendered = renderWithProviders(<div aria-label='Appearance readiness probe' />)
  const appearance = rendered
    .getByLabelText('Appearance readiness probe')
    .closest('[data-color-mode]')
  expect(appearance?.getAttribute('aria-busy')).toBe('true')

  await waitFor(() => expect(appearance?.getAttribute('aria-busy')).toBe('false'))
  rendered.unmount()
  resetSettingsSnapshotAdmission(rendered.queryClient)
  rendered.queryClient.clear()
})

test('optional symbols can stay pending while the appearance becomes ready', async ({ client }) => {
  expect(client).toBeDefined()
  const queryClient = createTestQueryClient()
  const held = Promise.withResolvers<string | null>()
  const options = fontQueryOptions(NERD_SYMBOLS_FONT)
  // Hold the external download, preserving the real query's key and lifetime.
  const pending = queryClient.query({ ...options, queryFn: () => held.promise })
  const rendered = renderWithProviders(<div aria-label='Appearance readiness probe' />, {
    queryClient,
  })
  const appearance = rendered
    .getByLabelText('Appearance readiness probe')
    .closest('[data-color-mode]')
  try {
    await waitFor(() => expect(appearance?.getAttribute('aria-busy')).toBe('false'))
    expect(queryClient.getQueryState(options.queryKey)?.status).toBe('pending')
  } finally {
    held.resolve(null)
    await pending
    rendered.unmount()
    resetSettingsSnapshotAdmission(queryClient)
    queryClient.clear()
  }
})

function wrapper(queryClient: ReturnType<typeof createTestQueryClient>) {
  return ({ children }: { readonly children: ReactNode }) => (
    <AppProviders queryClient={queryClient}>{children}</AppProviders>
  )
}
