import { renderHook, waitFor } from '@testing-library/react'
import { afterEach } from 'vitest'

import { overlayQueryKeys } from '@/components/utils/query-keys'
import { useWarmOverlays } from '@/features/phone/hooks/use-warm-overlays'
import type { PhoneLevel } from '@/features/phone/utils/level'
import { resourceQueryClient } from '@/lib/resources/state/query-client'
import { expect, test } from '../../../../test/fixtures'

const keys = [overlayQueryKeys.sessionDialogs, overlayQueryKeys.themeStudioSlot]

afterEach(() => {
  for (const queryKey of keys) resourceQueryClient.removeQueries({ exact: true, queryKey })
})

function status(queryKey: (typeof keys)[number]) {
  return resourceQueryClient.getQueryState(queryKey)?.status
}

test('a phone opened straight into a session warms the closed dialogs once the screen shows', async () => {
  const { rerender } = renderHook(
    ({ level, shown }: { level: PhoneLevel; shown: boolean }) => useWarmOverlays(level, shown),
    { initialProps: { level: 'session', shown: false } },
  )
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(keys.map(status)).toEqual([undefined, undefined])

  rerender({ level: 'session', shown: true })
  await waitFor(() => expect(keys.map(status)).toEqual(['success', 'success']), { timeout: 5000 })
})

test('the session list leaves warming to its own readiness', async () => {
  renderHook(() => useWarmOverlays('sessions', true))
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(keys.map(status)).toEqual([undefined, undefined])
})
