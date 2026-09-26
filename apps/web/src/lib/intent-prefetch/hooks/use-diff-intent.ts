import {
  hashKey,
  useQueryClient,
  type QueryKey,
  type QueryExecuteOptions,
} from '@tanstack/react-query'
import { useEffect, useEffectEvent, useState, type KeyboardEvent } from 'react'
import { claimDiffIntent, startDiffIntent } from '@/lib/intent-prefetch/state/query-intent'
import { useSettingValue } from '@/hooks/use-setting-value'

export function useDiffIntent<T, K extends QueryKey>(
  options: QueryExecuteOptions<T, Error, T, T, K> | null,
  scope: string,
  active = false,
) {
  const client = useQueryClient()
  const master = useSettingValue('prefetch.enabled')
  const enabled = useSettingValue('prefetch.diffs') && master
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const wanted = enabled && (hovered || focused || active)
  const key = options ? hashKey(options.queryKey) : null
  const start = useEffectEvent(() =>
    options
      ? startDiffIntent(client, options, active ? 'active-row' : 'hover', enabled)
      : undefined,
  )
  useEffect(() => {
    if (wanted && key) return start()
  }, [client, key, scope, wanted, active])
  const claim = () => {
    if (options) claimDiffIntent(client, options.queryKey)
  }
  return {
    onPointerEnter: () => setHovered(true),
    onPointerLeave: () => setHovered(false),
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    onPointerDownCapture: claim,
    onKeyDownCapture: (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') claim()
    },
  }
}
