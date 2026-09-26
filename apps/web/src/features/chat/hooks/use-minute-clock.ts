import { useEffect, useState } from 'react'

const MINUTE_MS = 60_000

/** The time, refreshed each minute: enough for labels that name a minute. */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), MINUTE_MS)
    return () => clearInterval(timer)
  }, [])
  return now
}
