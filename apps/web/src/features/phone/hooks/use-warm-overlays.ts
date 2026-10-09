import { useEffect } from 'react'

import { warmDeferredOverlays } from '@/components/utils/overlay-modules'
import type { PhoneLevel } from '@/features/phone/utils/level'

/**
 * Loads the closed dialogs' code once the first screen settles, whichever level the phone opened
 * on. The session list warms them itself once its rows are in (`SessionsScreen`). Repeat calls
 * reuse the cached module queries, so each overlay downloads once per page.
 */
export function useWarmOverlays(level: PhoneLevel, shown: boolean) {
  useEffect(() => {
    if (!shown || level === 'sessions') return
    if (!('requestIdleCallback' in window)) {
      const timer = setTimeout(warmDeferredOverlays, 2000)
      return () => clearTimeout(timer)
    }
    const handle = window.requestIdleCallback(warmDeferredOverlays)
    return () => window.cancelIdleCallback(handle)
  }, [level, shown])
}
