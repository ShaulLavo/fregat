import { useLoaderFrame } from '@/theme/hooks/use-loader-frame'
import { ringFrames, plainFrames } from '@/theme/utils/loading'
import type { Theme } from '@/theme/utils/theme'

export function RingLoader({
  theme,
  reducedMotion,
  label,
}: {
  theme: Theme
  reducedMotion?: boolean
  label?: string
}) {
  const reduced = reducedMotion ?? theme.reducedMotion
  const frames = theme.noColor ? plainFrames : ringFrames
  const frame = useLoaderFrame(frames.length, 250, reduced)
  return (
    <text fg={theme.mutedForeground}>
      {frames[frame]}
      {label ? ` ${label}` : ''}
    </text>
  )
}
