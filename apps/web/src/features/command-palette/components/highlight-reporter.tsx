import { useCommandState } from '@workspace/ui/components/command'
import { useEffect, useEffectEvent } from 'react'

/**
 * Reports the row cmdk highlights, however it moved: keys, pointer, or a
 * re-filter. Renders inside the `Command` whose store it reads.
 */
export function HighlightReporter({
  onHighlight,
}: {
  readonly onHighlight: (value: string) => void
}) {
  const value = useCommandState((state) => state.value)
  const report = useEffectEvent((highlighted: string) => onHighlight(highlighted))

  useEffect(() => {
    if (!value) return

    report(value)
  }, [value])

  return null
}
