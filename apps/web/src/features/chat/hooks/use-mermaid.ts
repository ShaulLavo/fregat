import { useEffect, useState } from 'react'

import { hasMermaidFence } from '@/features/chat/utils/markdown-fence'
import { loadedMermaid, loadMermaid, type MermaidRenderer } from '@/features/chat/state/mermaid'

/**
 * The diagram renderer for this message, or `null` while its fences must stay
 * code blocks: no mermaid fence, still streaming (a half-written graph is not
 * a diagram), or the library not loaded yet.
 */
export function useMermaid(text: string, streaming: boolean): MermaidRenderer | null {
  const wanted = !streaming && hasMermaidFence(text)
  // State, not a module read during render: the compiler would otherwise
  // memoize the read on `wanted` and never see the load land.
  const [renderer, setRenderer] = useState(loadedMermaid)

  useEffect(() => {
    if (!wanted || renderer) return

    let cancelled = false
    void loadMermaid().then((loaded) => {
      if (loaded && !cancelled) setRenderer(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [renderer, wanted])

  return wanted ? renderer : null
}
