import { QueryClientProvider } from '@tanstack/react-query'
import {
  DEFAULT_SETTING_VALUES,
  type SettingsSnapshot,
  type SettingsValues,
} from '@workspace/contracts'
import { act, render, screen, waitFor } from '@testing-library/react'
import { useLayoutEffect } from 'react'

import { createTestQueryClient } from '../../../../test/render'
import { expect, test } from '../../../../test/fixtures'
import { useSettingsProjection } from '../hooks/use-settings-projection'
import { AppearanceProvider } from '../providers/appearance-provider'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'

test('applies a live density change before descendant layout effects run', async () => {
  const previousDensity = document.documentElement.getAttribute('data-density')
  const queryClient = createTestQueryClient()
  const observations: string[] = []
  document.documentElement.setAttribute('data-density', 'compact')
  queryClient.setQueryData(settingsKeys.document(), settingsSnapshot('compact'))

  const result = render(
    <QueryClientProvider client={queryClient}>
      <AppearanceProvider>
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
  }
})

function DensityObserver({ observations }: { observations: string[] }) {
  const density = useSettingsProjection()?.values['workbench.density']

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
    values: { ...DEFAULT_SETTING_VALUES, 'workbench.density': density },
  }
}

function restoreDensity(value: string | null) {
  if (value === null) {
    document.documentElement.removeAttribute('data-density')

    return
  }

  document.documentElement.setAttribute('data-density', value)
}
