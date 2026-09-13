import { useEffect, useState } from 'react'

import { loadedMarkdownExtensions, loadMarkdownExtension } from '../state/extensions'
import type { MarkdownBlock } from '../utils/blocks'
import type { HastExtensions } from '../utils/hast'

/**
 * The deferred stages this document needs, loading whichever is missing.
 * Returns the module's current snapshot; a load that lands re-renders the
 * caller with the next one.
 */
export function useMarkdownExtensions(blocks: readonly MarkdownBlock[]): HastExtensions {
  const [extensions, setExtensions] = useState(loadedMarkdownExtensions)
  const wantRaw = blocks.some((block) => block.hasHtml)
  const wantMath = blocks.some((block) => block.hasMath)
  const loadRaw = wantRaw && !extensions.raw
  const loadMath = wantMath && !extensions.math

  useEffect(() => {
    if (!loadRaw && !loadMath) return

    let cancelled = false
    const accept = (next: HastExtensions) => {
      if (!cancelled) setExtensions(next)
    }
    if (loadRaw) void loadMarkdownExtension('raw').then(accept)
    if (loadMath) void loadMarkdownExtension('math').then(accept)

    return () => {
      cancelled = true
    }
  }, [loadMath, loadRaw])

  return extensions
}
