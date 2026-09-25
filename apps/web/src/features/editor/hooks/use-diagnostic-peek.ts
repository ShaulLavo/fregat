import type { LanguageServerDiagnosticMarkerEvent } from '@singapore-editor/lsp-plugin'
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'

import { createDiagnosticPeekSource } from '@/features/editor/state/diagnostic-peek-source'
import { fileUriForPath } from '@workspace/contracts'
import { useFocusService } from '@/lib/focus/hooks/use-service'
import { registeredFocusTarget, type FocusTargetToken } from '@/lib/focus/state/service'

export function useDiagnosticPeek({ active, filePath }: { active: boolean; filePath: string }) {
  const focus = useFocusService()
  // The external store and its Editor plugin must share one identity for the document lifecycle.
  // Manual, because the effect below depends on it and the compiler's cache is a cache, not an
  // identity guarantee: a recompute would hand the plugin a second store.
  const source = useMemo(() => createDiagnosticPeekSource(fileUriForPath(filePath)), [filePath])
  const origin = useRef<FocusTargetToken | null>(null)
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)

  // Stable identity keeps the LSP plugin alive across peek geometry updates.
  const onDidNavigateDiagnostic = (event: LanguageServerDiagnosticMarkerEvent) => {
    const claim = source.claim(event)
    if (claim.kind === 'claimed') origin.current = focus.captureOrigin()
    return claim
  }

  const close = (restoreOrigin: boolean) => {
    const captured = origin.current
    origin.current = null
    source.close()
    if (!restoreOrigin || !captured || !focus.isRegistered(captured)) return
    void focus.request(registeredFocusTarget(captured)).completion
  }

  useEffect(() => {
    if (active) return
    origin.current = null
    source.close()
  }, [active, source])

  useEffect(
    () => () => {
      origin.current = null
      source.close()
    },
    [source],
  )

  return { close, onDidNavigateDiagnostic, plugin: source.plugin, snapshot }
}
