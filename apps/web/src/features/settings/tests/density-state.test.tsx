import { QueryClientProvider } from '@tanstack/react-query'
import {
  DEFAULT_SETTING_VALUES,
  type SettingsSnapshot,
  type SettingsValues,
} from '@workspace/contracts'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { useLayoutEffect, type ReactNode } from 'react'

import { createTestQueryClient } from '../../../../test/render'
import { expect, test } from '../../../../test/fixtures'
import { useWorkbenchDensity } from '../hooks/use-workbench-density'
import { AppearanceProvider } from '../providers/appearance-provider'
import { writeBootMirror } from '@/lib/settings-boot-mirror'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'

const BOOT_MIRROR_KEY = 'platform.settings-boot-mirror.v1'

test('uses the boot mirror until the settings snapshot lands', async () => {
  const previousMirror = localStorage.getItem(BOOT_MIRROR_KEY)
  const previousDensity = document.documentElement.getAttribute('data-density')
  const queryClient = createTestQueryClient()
  const pendingSnapshot = Promise.withResolvers<SettingsSnapshot>()
  writeBootMirror(settingsValues('cozy'))
  document.documentElement.setAttribute('data-density', 'cozy')
  void queryClient.prefetchQuery({
    queryFn: () => pendingSnapshot.promise,
    queryKey: settingsKeys.document(),
  })

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <AppearanceProvider bootDensity='cozy'>{children}</AppearanceProvider>
      </QueryClientProvider>
    )
  }

  const { rerender, result, unmount } = renderHook(() => useWorkbenchDensity(), {
    wrapper: Wrapper,
  })

  try {
    expect(result.current).toBe('cozy')

    writeBootMirror(settingsValues('compact'))
    rerender()
    expect(result.current).toBe('cozy')
    expect(document.documentElement.dataset.density).toBe('cozy')

    await act(async () => {
      pendingSnapshot.resolve(settingsSnapshot('compact'))
      await pendingSnapshot.promise
    })
    await waitFor(() => expect(result.current).toBe('compact'))
  } finally {
    unmount()
    restoreDensity(previousDensity)
    restoreBootMirror(previousMirror)
  }
})

test('applies a live density change before descendant layout effects run', async () => {
  const previousMirror = localStorage.getItem(BOOT_MIRROR_KEY)
  const previousDensity = document.documentElement.getAttribute('data-density')
  const queryClient = createTestQueryClient()
  const observations: string[] = []
  document.documentElement.setAttribute('data-density', 'compact')
  queryClient.setQueryData(settingsKeys.document(), settingsSnapshot('compact'))

  const result = render(
    <QueryClientProvider client={queryClient}>
      <AppearanceProvider bootDensity='compact'>
        <DensityObserver observations={observations} />
      </AppearanceProvider>
    </QueryClientProvider>,
  )

  try {
    expect(observations.at(-1)).toBe('compact:compact')

    await act(async () => {
      queryClient.setQueryData(settingsKeys.document(), settingsSnapshot('cozy'))
    })
    await waitFor(() => expect(screen.getByTestId('density-observer')).toHaveTextContent('cozy'))

    expect(observations.at(-1)).toBe('cozy:cozy')
  } finally {
    result.unmount()
    restoreDensity(previousDensity)
    restoreBootMirror(previousMirror)
  }
})

function DensityObserver({ observations }: { observations: string[] }) {
  const density = useWorkbenchDensity()

  useLayoutEffect(() => {
    observations.push(`${density}:${document.documentElement.dataset.density}`)
  }, [density, observations])

  return <output data-testid='density-observer'>{density}</output>
}

function settingsSnapshot(density: SettingsValues['workbench.density']): SettingsSnapshot {
  return {
    diagnostics: [],
    layers: [],
    serverVersion: { epoch: 'density-test', sequence: density === 'compact' ? 1 : 2 },
    values: settingsValues(density),
  }
}

function settingsValues(density: SettingsValues['workbench.density']): SettingsSnapshot['values'] {
  return { ...DEFAULT_SETTING_VALUES, 'workbench.density': density }
}

function restoreBootMirror(value: string | null) {
  if (value === null) {
    localStorage.removeItem(BOOT_MIRROR_KEY)

    return
  }

  localStorage.setItem(BOOT_MIRROR_KEY, value)
}

function restoreDensity(value: string | null) {
  if (value === null) {
    document.documentElement.removeAttribute('data-density')

    return
  }

  document.documentElement.setAttribute('data-density', value)
}
