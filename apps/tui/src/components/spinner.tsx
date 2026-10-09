import { useLoaderFrame } from '@/theme/hooks/use-loader-frame'
import { spinnerFrames, plainFrames } from '@/theme/utils/loading'
import type { Theme } from '@/theme/utils/theme'

export function Spinner({ theme, reducedMotion }: { theme: Theme; reducedMotion?: boolean }) {
  const reduced = reducedMotion ?? theme.reducedMotion
  const frames = theme.noColor ? plainFrames : spinnerFrames
  const frame = useLoaderFrame(frames.length, 100, reduced)
  return <text fg={theme.foreground}>{frames[frame]}</text>
}
