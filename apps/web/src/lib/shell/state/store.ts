import type { PhoneScreen } from '@workspace/client-core/address/grammar'
import { create } from 'zustand'

import {
  SHELL_QUERIES,
  initialShellKind,
  nextShellKind,
  type ShellKind,
} from '@/lib/shell/utils/kind'

type ShellState = {
  /** The shell the viewport asks for. The workspace view keeps the old one until this one loads. */
  readonly kind: ShellKind
  /** The phone shell's pushed screen; the address carries it so Back pops it. */
  readonly phoneScreen: PhoneScreen | null
  /** A cold start from the bare app URL restored a stored address; the phone opens on its session list instead. */
  readonly phoneStartsAtSessions: boolean
}

const matches = (query: string) => window.matchMedia(query).matches

export const useShellStore = create<ShellState>(() => ({
  kind: initialShellKind(matches),
  phoneScreen: null,
  phoneStartsAtSessions: false,
}))

/** True once, for the first phone shell after a cold start from the bare app URL. */
export function takePhoneStartAtSessions() {
  const starts = useShellStore.getState().phoneStartsAtSessions
  if (starts) useShellStore.setState({ phoneStartsAtSessions: false })
  return starts
}

export function setPhoneScreen(phoneScreen: PhoneScreen | null) {
  if (useShellStore.getState().phoneScreen === phoneScreen) return
  useShellStore.setState({ phoneScreen })
}

/** The phone screen the address records: none while the workbench is up. */
export function addressedPhoneScreen() {
  const state = useShellStore.getState()
  return state.kind === 'phone' ? state.phoneScreen : null
}

export function isPhoneShell() {
  return useShellStore.getState().kind === 'phone'
}

/** Follows the breakpoints, not every resize: three media queries, each firing only when crossed. */
export function watchShellKind() {
  const lists = SHELL_QUERIES.map((query) => window.matchMedia(query))
  const update = () => {
    const kind = nextShellKind(useShellStore.getState().kind, matches)
    if (kind !== useShellStore.getState().kind) useShellStore.setState({ kind })
  }
  for (const list of lists) list.addEventListener('change', update)
  return () => {
    for (const list of lists) list.removeEventListener('change', update)
  }
}
