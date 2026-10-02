import { act } from '@testing-library/react'
import {
  resetSettingsIntentStore,
  settingsIntentStatus,
  submitSettingsIntent,
  type ActiveSettingsIntent,
} from '@workspace/client-core/settings/intent-store'
import { afterAll, vi } from 'vitest'

import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'
import { log } from '@/lib/client-logging'
import { LONG_HOLD_MS } from '@/lib/optimistic/hold-diagnostics'

let pendingSettingsIntent: ActiveSettingsIntent | undefined

afterAll(async () => {
  try {
    expect(document.body.textContent).not.toContain('Settings intent owner')
    expect(pendingSettingsIntent).toBeDefined()
    const status = settingsIntentStatus(pendingSettingsIntent!.intentId)
    const querySelectorAll = vi.spyOn(document, 'querySelectorAll')
    vi.advanceTimersByTime(LONG_HOLD_MS)

    expect({ status, diagnosticReads: querySelectorAll.mock.calls.length }).toEqual({
      status: null,
      diagnosticReads: 0,
    })
    await expect(pendingSettingsIntent!.settled).resolves.toBe('discarded')
  } finally {
    resetSettingsIntentStore()
    pendingSettingsIntent = undefined
    vi.useRealTimers()
    vi.restoreAllMocks()
  }
})

test('shared DOM teardown discards pending settings intents and clears their hold diagnostics', () => {
  const { queryClient } = renderWithProviders(<div>Settings intent owner</div>)

  vi.useFakeTimers()
  vi.spyOn(log, 'warn').mockImplementation(() => undefined)
  act(() => {
    pendingSettingsIntent = submitSettingsIntent(queryClient, 'user', [
      { kind: 'set', key: 'editor.fontSize', value: 20 },
    ]).entry
  })

  expect(settingsIntentStatus(pendingSettingsIntent!.intentId)).toBe('pending')
  expect(document.body.textContent).toContain('Settings intent owner')
})
