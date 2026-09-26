import { useEffect, useSyncExternalStore } from 'react'
import {
  loadedMarkdownExtensions,
  loadMarkdownExtension,
  subscribeMarkdownExtensions,
} from '../state/extensions'
import type { MarkdownBlock } from '../utils/blocks'
import type { HastExtensions } from '../utils/hast'

export function useMarkdownExtensions(blocks: readonly MarkdownBlock[]): HastExtensions {
  const extensions = useSyncExternalStore(
    subscribeMarkdownExtensions,
    loadedMarkdownExtensions,
    loadedMarkdownExtensions,
  )
  const loadRaw = blocks.some((block) => block.hasHtml) && !extensions.raw
  const loadMath = blocks.some((block) => block.hasMath) && !extensions.math
  useEffect(() => {
    if (loadRaw) void loadMarkdownExtension('raw')
    if (loadMath) void loadMarkdownExtension('math')
  }, [loadMath, loadRaw])
  return extensions
}
