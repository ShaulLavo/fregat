import type { FilesystemPath, TabContent } from '@/lib/documents/utils/types'
import { createContext } from 'react'
import type { OrchestrationProjectScript, ScopedProjectRef } from '@workspace/contracts'

import type { GotoLineTarget } from '@/features/command-palette/utils/goto-line-target'
import type { SessionRailItem } from '@workspace/client-core/chat/rail/model'
import type { FlatDocumentSymbol } from '@/lib/document-symbols'
import type { PlatformCommandId } from '@/keymap/types'

export type CommandPaletteActions = {
  readonly previewColorTheme: (themeId: string) => void
  readonly selectColorTheme: (themeId: string) => void
  readonly selectContent: (content: TabContent) => Promise<void>
  readonly selectFile: (path: FilesystemPath) => Promise<void>
  /** Moves the caret in the active editor to a hand-typed line and column. */
  readonly selectGotoLine: (target: GotoLineTarget) => Promise<void>
  readonly selectPlatformCommand: (command: PlatformCommandId) => Promise<void>
  /** Runs a project script in the terminal, revealing one if none is open. */
  readonly selectScript: (script: OrchestrationProjectScript) => Promise<void>
  /** Reveals chat mode, activates the owning project, and puts the session on the stage. */
  readonly selectSession: (session: SessionRailItem) => Promise<void>
  readonly selectSymbol: (symbol: FlatDocumentSymbol) => Promise<void>
  readonly startSessionDraft: (ref: ScopedProjectRef) => Promise<void>
}

export const CommandPaletteActionsContext = createContext<CommandPaletteActions | null>(null)
