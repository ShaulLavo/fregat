import { useEffect, useState } from 'react'

import { TickerText } from '@/components/ticker-text'
import { formatWorkingTimer } from '@/features/chat/utils/formatters'

export function WorkingTimer({ startedAt }: { startedAt: string }) {
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(intervalId)
  }, [startedAt])

  return <TickerText text={formatWorkingTimer(startedAt, new Date(nowMs).toISOString()) ?? '0s'} />
}
