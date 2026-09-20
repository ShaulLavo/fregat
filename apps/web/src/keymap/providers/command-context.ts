import type { WorkspaceRoot } from '@/lib/documents/utils/types'
import { createContext } from 'react'

import type { PaletteScope } from '@/features/command-palette/utils/types'
import type { OpenWorkspaceRootResult } from '@/features/workspace/hooks/use-open-root'
import type {
  PlatformCommandTarget,
  WorkspaceCommandRuntime,
  WorkspaceCommandSnapshot,
} from '@/keymap/define-command'
import type { CommandBus, CommandInvocation } from '@/keymap/state/command-bus'
import type { PlatformCommandId, PlatformKeyBinding } from '@/keymap/types'
import type { PendingChordLabel } from '@singapore-editor/core/keymap'
import type { FocusTargetToken } from '@/lib/focus/state/service'

export type PlatformCommandBus = CommandBus<
  PlatformCommandId,
  WorkspaceCommandRuntime,
  WorkspaceCommandSnapshot,
  PlatformCommandTarget,
  CommandInvocation
>

export type CommandContextValue = {
  readonly bindings: readonly PlatformKeyBinding[]
  readonly bus: PlatformCommandBus
  readonly claimKeybinding: (event: KeyboardEvent) => boolean
  readonly closePalette: (restoreOrigin: boolean) => void
  readonly openWorkspaceRoot: (rootPath: WorkspaceRoot) => Promise<OpenWorkspaceRootResult>
  readonly paletteOpen: boolean
  readonly paletteOrigin: FocusTargetToken | null
  readonly paletteScope: PaletteScope | null
  readonly paletteSearch: string
  readonly pendingChord: PendingChordLabel | null
  readonly popPaletteScope: () => void
  readonly setPaletteOpen: (open: boolean) => void
  readonly setPaletteSearch: (search: string) => void
}

export const CommandContext = createContext<CommandContextValue | null>(null)
