import { cssFamily, type FontRole } from '@workspace/contracts'
import { Shimmer } from '@workspace/ui/components/shimmer'
import { cn } from '@workspace/ui/lib/utils'

import { useFontSample } from '@/features/settings/hooks/use-font-sample'

/**
 * `text` drawn in the font `fontRef` names. Until the subset arrives it shimmers in the role's
 * fallback face; a font that will not download stays in the fallback, still readable.
 */
export function FontSample({
  className,
  fontRef,
  role,
  sampleText,
  serverSample,
  text,
}: {
  className?: string
  fontRef: string
  role: FontRole
  /** Every glyph the sample family must hold; defaults to `text`. */
  sampleText?: string
  /** False when the server has nothing to sample, so typing costs no request per keystroke. */
  serverSample?: boolean
  text: string
}) {
  const { family, pending } = useFontSample(fontRef, sampleText ?? text, serverSample)
  const fallback = role === 'ui' ? 'var(--font-ui)' : 'var(--font-code)'
  const style = family ? { fontFamily: `${cssFamily(family)}, ${fallback}` } : undefined

  return (
    <span className={cn('truncate', className)} style={style}>
      {pending ? <Shimmer>{text}</Shimmer> : text}
    </span>
  )
}
