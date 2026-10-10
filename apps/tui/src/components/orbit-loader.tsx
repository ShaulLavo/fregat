import { useLoaderFrame } from '@/theme/hooks/use-loader-frame'
import { orbitFrames, plainFrames } from '@/theme/utils/loading'
import type { Theme } from '@/theme/utils/theme'

export function OrbitLoader({ theme, reducedMotion }: { theme: Theme; reducedMotion?: boolean }) {
  const reduced = reducedMotion ?? theme.reducedMotion
  const frames = theme.noColor ? plainFrames : orbitFrames
  const frame = useLoaderFrame(frames.length, 250, reduced)
  return <text fg={theme.primary}>{frames[frame]}</text>
}
