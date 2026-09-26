import { useMemo } from 'react'
import { cssFamily, type FontRole } from '@workspace/contracts'
import { Spinner } from '@workspace/ui/components/spinner'
import { useHeldUntilReady } from '@/hooks/use-held-until-ready'
import { cn } from '@workspace/ui/lib/utils'

import { useFontSample } from '@/features/settings/hooks/use-font-sample'

/**
 * `text` drawn in the font `fontRef` names. A loaded sample stays whole until the next
 * subset arrives; a failed download settles to the role's fallback face.
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
  // useHeldUntilReady stores this value during render and needs stable identity.
  const next = useMemo(() => ({ family, text }), [family, text])
  const shown = useHeldUntilReady(next, !pending)
  const fallback = role === 'ui' ? 'var(--font-ui)' : 'var(--font-code)'
  const style = shown.family ? { fontFamily: `${cssFamily(shown.family)}, ${fallback}` } : undefined

  return (
    <>
      <span className={cn('truncate', className)} style={style} title={shown.text}>
        {shown.text}
      </span>
      {pending ? <Spinner size='xs' label='Loading font sample' /> : null}
    </>
  )
}
