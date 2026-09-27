import { useEffect } from 'react'

import { resourceQueryClient } from '@/lib/resources/state/query-client'
import { screenQueryOptions } from '@/features/phone/utils/screen-query'

/**
 * After the first screen paints, the two every visit uses load in idle time: the list and a
 * session. Changes, files and the terminal wait for their press, so the editor stays unloaded.
 */
export function useWarmScreens() {
  useEffect(() => {
    const warm = () => {
      for (const level of ['sessions', 'session'] as const)
        void resourceQueryClient
          .query(screenQueryOptions(level))
          .then(() => undefined)
          .catch(() => undefined)
    }
    if (!('requestIdleCallback' in window)) {
      const timer = setTimeout(warm, 2000)
      return () => clearTimeout(timer)
    }
    const handle = window.requestIdleCallback(warm)
    return () => window.cancelIdleCallback(handle)
  }, [])
}
