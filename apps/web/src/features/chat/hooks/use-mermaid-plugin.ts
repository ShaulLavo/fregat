import type { DiagramPlugin } from '@streamdown/mermaid'
import { useEffect, useState } from 'react'

import { hasMermaidFence } from '@/features/chat/utils/markdown-fence'
import { loadedMermaidPlugin, loadMermaidPlugin } from '@/features/chat/state/mermaid-plugin'

/**
 * The diagram plugin for this message, or `null` while it must stay a code
 * block: no mermaid fence, still streaming (a half-written graph is not a
 * diagram), or the plugin not loaded yet.
 */
export function useMermaidPlugin(text: string, streaming: boolean): DiagramPlugin | null {
  const wanted = !streaming && hasMermaidFence(text)
  // State, not a module read during render: the compiler would otherwise
  // memoize the read on `wanted` and never see the load land.
  const [plugin, setPlugin] = useState(loadedMermaidPlugin)

  useEffect(() => {
    if (!wanted || plugin) return

    let cancelled = false
    void loadMermaidPlugin().then((loaded) => {
      if (loaded && !cancelled) setPlugin(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [plugin, wanted])

  return wanted ? plugin : null
}
