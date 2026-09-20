import type { PanelImperativeHandle } from '@workspace/ui/components/resizable'
import { useLayoutEffect, useRef } from 'react'

/**
 * Drives a collapsible `ResizablePanel` from an open flag, so closing it keeps
 * its children mounted. The panel may join the group late, on its first open.
 */
export function useCollapsiblePanel(open: boolean) {
  const panelRef = useRef<PanelImperativeHandle>(null)
  const wasMounted = useRef(false)

  // Layout effect, so the group never paints the stale size for a frame.
  useLayoutEffect(() => {
    const panel = panelRef.current
    const settled = wasMounted.current
    wasMounted.current = panel !== null
    // A panel mounting in this commit has no layout yet, and the library throws.
    if (!panel || !settled) return
    if (open) panel.expand()
    else panel.collapse()
  }, [open])

  // StrictMode re-runs the effect above against a group that is registering again.
  useLayoutEffect(
    () => () => {
      wasMounted.current = false
    },
    [],
  )

  return panelRef
}
