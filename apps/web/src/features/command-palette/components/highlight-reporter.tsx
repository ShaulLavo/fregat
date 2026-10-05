import { useCommandState } from '@workspace/ui/components/command'
import { useEffect, useEffectEvent } from 'react'

/**
 * Reports the row cmdk highlights, however it moved: keys, pointer, or a
 * re-filter. Renders inside the `Command` whose store it reads.
 */
export function HighlightReporter({
  onHighlight,
  identity,
}: {
  readonly onHighlight: (value: string) => void | (() => void)
  readonly identity?: unknown
}) {
  const value = useCommandState((state) => state.value)
  const report = useEffectEvent((highlighted: string) => onHighlight(highlighted))

  useEffect(() => {
    if (!value) return
    return report(value)
  }, [value, identity])

  return null
}
