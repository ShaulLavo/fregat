import type { TerminalContextSelection } from '@workspace/client-core/chat/terminal-context'
import type { EnvironmentId } from '@workspace/contracts'
import { createContext } from 'react'

/** The workspace a capture came from. Only a composer in that workspace takes it. */
export type ComposerDestination = {
  readonly environmentId: EnvironmentId
  readonly rootPath: string
}

/**
 * The one way a capture surface outside chat puts something in the composer. Surfaces hand
 * over what they captured and where; chat decides which composer and draft it lands in.
 */
export type ComposerAttach = {
  readonly attachText: (source: string, text: string, destination: ComposerDestination) => boolean
  readonly attachTerminalContext: (
    selection: TerminalContextSelection | null,
    destination: ComposerDestination,
  ) => boolean
  /** For work that is its own conversation: a fresh draft, never the open session. */
  readonly attachTextToNewChat: (
    source: string,
    text: string,
    destination: ComposerDestination,
  ) => Promise<boolean>
}

export const ComposerAttachContext = createContext<ComposerAttach | null>(null)
