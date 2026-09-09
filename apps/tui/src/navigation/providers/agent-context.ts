import { createContext } from 'react'
import type { WorktreeId } from '@workspace/contracts'
import type { TerminalContextSelection } from '@workspace/client-core/chat/terminal-context'

export type AgentNavigation = {
  readonly openWorkbench: (path: string) => void | Promise<void>
  readonly queuePrompt: (input: {
    readonly worktreeId: WorktreeId
    readonly context: TerminalContextSelection
  }) => void
  readonly openFile: (location: {
    readonly rootPath: string
    readonly relativePath: string
    readonly line?: number
  }) => void | Promise<void>
}

export const AgentNavigationContext = createContext<AgentNavigation | null>(null)
