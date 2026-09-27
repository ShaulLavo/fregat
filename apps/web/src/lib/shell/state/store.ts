import type { AddressMode, PhoneScreen } from '@workspace/client-core/address/grammar'
import { create } from 'zustand'

import type { PhoneTab } from '@/lib/shell/utils/phone-tab'
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
  /** The desk's mode when the phone shell took over, put back when the workbench returns. */
  readonly deskMode: AddressMode | null
  /** The tab the phone's next file replaces; forgotten when the workbench returns. */
  readonly phoneTab: PhoneTab | null
}

// Node-environment tests import the store; with no window there is no phone.
const matches = (query: string) => typeof window !== 'undefined' && window.matchMedia(query).matches

export const useShellStore = create<ShellState>(() => ({
  kind: initialShellKind(matches),
  phoneScreen: null,
  phoneStartsAtSessions: false,
  deskMode: null,
  phoneTab: null,
}))

/** Opening a session on the phone moves it to chat mode; the desk gets its own mode back. */
export function rememberDeskMode(mode: AddressMode) {
  if (useShellStore.getState().deskMode === null) useShellStore.setState({ deskMode: mode })
}

export function takeDeskMode() {
  const { deskMode } = useShellStore.getState()
  if (deskMode !== null) useShellStore.setState({ deskMode: null })
  return deskMode
}

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

export function setPhoneTab(phoneTab: PhoneTab | null) {
  if (useShellStore.getState().phoneTab === phoneTab) return
  useShellStore.setState({ phoneTab })
}

export function isPhoneShell() {
  return useShellStore.getState().kind === 'phone'
}

/** Follows the breakpoints, not every resize: three media queries, each firing only when crossed. */
export function watchShellKind() {
  const lists = SHELL_QUERIES.map((query) => window.matchMedia(query))
  const update = () => {
    const kind = nextShellKind(useShellStore.getState().kind, matches)
    if (kind === useShellStore.getState().kind) return
    // Back at the desk, the phone's tab is an ordinary tab: the next phone file adds its own.
    useShellStore.setState(kind === 'workbench' ? { kind, phoneTab: null } : { kind })
  }
  for (const list of lists) list.addEventListener('change', update)
  return () => {
    for (const list of lists) list.removeEventListener('change', update)
  }
}
