import { useEffect, useState } from 'react'
import type { SessionRailEnvironment } from '@workspace/client-core/chat/rail/model'
import { useCoarseNow } from '@/features/chat/hooks/use-coarse-now'

export function useRailNow(environments: readonly SessionRailEnvironment[]) {
  const coarse = useCoarseNow()
  const [precise, setPrecise] = useState(0)
  const now = Math.max(coarse, precise)
  let deadline = Infinity
  for (const environment of environments) {
    if (!environment.capabilities?.sessionSnooze) continue
    for (const session of environment.sessions) {
      const wake = session.snoozedUntil ? Date.parse(session.snoozedUntil) : NaN
      if (wake > now) deadline = Math.min(deadline, wake)
    }
  }
  useEffect(() => {
    if (!Number.isFinite(deadline)) return
    const timer = window.setTimeout(
      () => setPrecise(Date.now()),
      Math.min(Math.max(0, deadline - Date.now()) + 1, 2_147_483_647),
    )
    return () => window.clearTimeout(timer)
  }, [deadline, coarse])
  return now
}
