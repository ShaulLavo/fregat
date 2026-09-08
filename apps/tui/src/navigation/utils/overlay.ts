import type { FocusToken } from '@/commands/state/focus'

export type DialogKind = 'commands' | 'address' | 'copy-address' | 'help'
export type Overlay = {
  readonly kind: DialogKind
  readonly origin: FocusToken | null
  readonly query?: string
}
