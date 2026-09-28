import {
  hashKey,
  useQueryClient,
  type QueryKey,
  type QueryExecuteOptions,
} from '@tanstack/react-query'
import { useEffect, useEffectEvent, useState, type KeyboardEvent } from 'react'
import { useForesight } from '@/hooks/use-foresight'
import { claimDiffIntent, startDiffIntent } from '@/lib/intent-prefetch/state/query-intent'
import { INTENT_PREFETCH_HIT_SLOP_PX } from '@/lib/intent-prefetch-options'
import { useSettingValue } from '@/hooks/use-setting-value'

// Foresight fires once per approach and has no leave; a predicted read stays leased this long
// after the pointer has gone, so a press at the end of a fast trajectory still claims it.
const PREDICTION_HOLD_MS = 2_000

/** Leases a diff read while Foresight predicts a press, the row has focus, or it is active. */
export function useDiffIntent<T, K extends QueryKey>(
  options: QueryExecuteOptions<T, Error, T, T, K> | null,
  scope: string,
  active = false,
) {
  const client = useQueryClient()
  const master = useSettingValue('prefetch.enabled')
  const enabled = useSettingValue('prefetch.diffs') && master
  const [predicted, setPredicted] = useState(false)
  const [pointerInside, setPointerInside] = useState(false)
  const [focused, setFocused] = useState(false)
  const wanted = enabled && (predicted || focused || active)
  const key = options ? hashKey(options.queryKey) : null
  const { elementRef } = useForesight<HTMLElement>({
    callback: () => setPredicted(true),
    enabled: enabled && key !== null,
    hitSlop: INTENT_PREFETCH_HIT_SLOP_PX,
    name: `diff:${scope}:${key ?? 'none'}`,
    reactivateAfter: PREDICTION_HOLD_MS,
  })
  useEffect(() => {
    if (!predicted || pointerInside) return
    const timer = setTimeout(() => setPredicted(false), PREDICTION_HOLD_MS)
    return () => clearTimeout(timer)
  }, [predicted, pointerInside])
  const start = useEffectEvent(() => {
    if (!options) return undefined
    const trigger = active ? 'active-row' : focused ? 'focus' : 'trajectory'
    return startDiffIntent(client, options, trigger, enabled)
  })
  useEffect(() => {
    if (wanted && key) return start()
  }, [client, key, scope, wanted, active])
  const claim = () => {
    if (options) claimDiffIntent(client, options.queryKey)
  }
  return {
    ref: elementRef,
    onPointerEnter: () => setPointerInside(true),
    onPointerLeave: () => setPointerInside(false),
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    onPointerDownCapture: claim,
    onKeyDownCapture: (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') claim()
    },
  }
}
