import type { LiveCheckVerdict } from '@workspace/contracts'
import { useEffect, useEffectEvent, useRef } from 'react'

import { liveCheckToastId } from '@/features/server-update/utils/live-check-toast'
import { toastError } from '@/lib/toast-error'

/** Toasts a failed post-restart live check once, with the server's rollback command as its fix. */
export function useLiveCheckToast(verdict: LiveCheckVerdict | null | undefined) {
  const shown = useRef<string | null>(null)
  const id = liveCheckToastId(verdict, performance.timeOrigin)

  const show = useEffectEvent((toastId: string) => {
    const error = verdict?.error
    if (!error || shown.current === toastId) return
    shown.current = toastId
    toastError(
      error.message,
      { id: toastId, description: error.fix, duration: Infinity },
      { ...error, title: 'Live check failed' },
    )
  })

  useEffect(() => {
    if (id) show(id)
  }, [id])
}
