import { ForesightManager } from 'js.foresight'
import { useEffect } from 'react'
import { log } from '@/lib/client-logging'
import { FILE_PICKER_INTENT_PREFIX } from '@/features/file-picker/utils/intent'

/** One event per open picker: how many row prefetches each Foresight predictor asked for. */
export function useIntentHitLog(open: boolean) {
  useEffect(() => {
    if (!open) return
    const hits: Record<string, number> = {}
    const controller = new AbortController()
    ForesightManager.instance.addEventListener(
      'callbackInvoked',
      (event) => {
        if (!event.state.name.startsWith(FILE_PICKER_INTENT_PREFIX)) return
        hits[event.hitType.kind] = (hits[event.hitType.kind] ?? 0) + 1
      },
      { signal: controller.signal },
    )
    return () => {
      controller.abort()
      if (Object.keys(hits).length === 0) return
      log.info({ action: 'file-picker.prefetch_intents', area: 'file-picker', hits })
    }
  }, [open])
}
