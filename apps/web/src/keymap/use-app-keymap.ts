import { useEffectEvent, useLayoutEffect, useState } from 'react'
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { PendingChordLabel } from '@fregat/hotkeys'
import type { PlatformCommandBus } from '@/keymap/providers/command-context'
import { createWindowKeymap, type WindowKeymap } from '@/keymap/state/window-keymap'
import type { PlatformKeyBinding } from '@/keymap/types'
import type { FocusService } from '@/lib/focus/state/service'

export function useAppKeymap({
  bindings,
  bus,
  focus,
}: {
  readonly bindings: readonly PlatformKeyBinding[]
  readonly bus: Pick<PlatformCommandBus, 'capture'>
  readonly focus: FocusService
}) {
  const [state] = useState(() =>
    createStore<{
      readonly keymap: WindowKeymap | null
      readonly pendingChord: PendingChordLabel | null
    }>(() => ({ keymap: null, pendingChord: null })),
  )
  const keymap = useStore(state, (snapshot) => snapshot.keymap)
  const pendingChord = useStore(state, (snapshot) => snapshot.pendingChord)
  const create = useEffectEvent(() =>
    createWindowKeymap({
      bindings,
      bus,
      focus,
      onPendingChange: (pendingChord) => state.setState({ pendingChord }),
    }),
  )
  useLayoutEffect(() => {
    const current = create()
    state.setState({ keymap: current })
    return () => current.dispose()
  }, [bus, focus, state])
  useLayoutEffect(() => keymap?.updateBindings(bindings), [bindings, keymap])
  return { keymap, pendingChord }
}
