import { useLayoutEffect, useState } from 'react'

import type { PlatformCommandBus } from '@/keymap/providers/command-context'
import { createPlatformKeymapSession } from '@/keymap/state/keymap-session'
import type { PlatformKeyBinding } from '@/keymap/types'
import { appKeyBindingsForPane } from '@/keymap/utils/app-bindings'
import type { PendingChordLabel } from '@singapore-editor/core/keymap'
import type { FocusArea, FocusService, FocusTargetToken } from '@/lib/focus/state/service'

export function useAppKeymap({
  bindings,
  bus,
  focus,
  focusedPane,
  focusedTarget = null,
}: {
  readonly bindings: readonly PlatformKeyBinding[]
  readonly bus: Pick<PlatformCommandBus, 'capture'>
  readonly focus?: FocusService
  readonly focusedPane: FocusArea
  readonly focusedTarget?: FocusTargetToken | null
}) {
  const [pendingChord, setPendingChord] = useState<PendingChordLabel | null>(null)
  // Table identity must remain stable while the pending label renders.
  const activeBindings = appKeyBindingsForPane(bindings, focusedPane)
  // Key ownership must survive focus/table changes until the corresponding keyup.
  const [session] = useState(() =>
    createPlatformKeymapSession({
      bus,
      focus,
      focusedPane,
      focusedTarget,
      onPendingChange: setPendingChord,
      bindings: activeBindings,
    }),
  )

  useLayoutEffect(() => {
    session.update({
      bus,
      focus,
      focusedPane,
      focusedTarget,
      onPendingChange: setPendingChord,
      bindings: activeBindings,
    })
  }, [bus, focus, focusedPane, focusedTarget, session, activeBindings])
  useLayoutEffect(() => session.mount(), [session])

  return { claimKeybinding: session.claimKeybinding, pendingChord }
}
