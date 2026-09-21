import type {
  SessionId,
  SessionInteractionModeSetCommand,
  SessionRuntimeModeSetCommand,
} from '@workspace/contracts'
import { type ReactNode } from 'react'

import type { ChatTransport } from '@/features/chat/transport/chat-transport'
import {
  createInteractionModeSetCommand,
  createRuntimeModeSetCommand,
} from '@workspace/client-core/chat/commands'
import { dispatchChatCommand } from '@/features/chat/utils/command-dispatch'
import {
  ChatComposerModesContext,
  type ChatComposerModes,
} from '@/features/chat/providers/composer-modes-context'
import {
  useChatInputDraftStore,
  type ChatInputDraftTarget,
} from '@/features/chat/state/chat-input-draft-store'

type DispatchCommand = ChatTransport['dispatchCommand']
type ModeSetCommand = SessionInteractionModeSetCommand | SessionRuntimeModeSetCommand

/**
 * Owns the composer's access and plan/build picks for one session. A pick is two
 * facts at once: the draft override the next turn carries, and the session's own
 * mode — without the second one the session projection keeps reporting whatever
 * it was created with, so the sidebar and any other client read the wrong mode.
 *
 * The dispatch seam arrives as a prop rather than being reached for, which keeps
 * the menu renderable against any `ChatTransport`, including the real
 * in-process one under test.
 *
 * `sessionId` is null on the draft composer, where there is no session to set a
 * mode on yet. The pick still lands in the draft, and the turn that creates the
 * session carries it through `bootstrap.createSession`.
 */
export function ChatComposerModesProvider({
  children,
  dispatchCommand,
  draftTarget,
  sessionId,
}: {
  readonly children: ReactNode
  readonly dispatchCommand: DispatchCommand
  readonly draftTarget: ChatInputDraftTarget
  readonly sessionId: SessionId | null
}) {
  const setInteractionMode = useChatInputDraftStore((state) => state.setInteractionMode)
  const setRuntimeMode = useChatInputDraftStore((state) => state.setRuntimeMode)
  // Context value identity: this wraps the whole composer subtree, so a fresh
  // object every render would repaint the panels and the input beside the menu.
  const value: ChatComposerModes = {
    selectInteractionMode: async (interactionMode) => {
      // Local first: the pick has to survive an offline or rejected dispatch,
      // because the turn command is what actually carries it to the provider.
      setInteractionMode(draftTarget, interactionMode)
      if (!sessionId) return true

      return dispatchModeSet({
        command: createInteractionModeSetCommand({
          interactionMode,
          sessionId,
        }),
        context: { interactionMode },
        dispatchCommand,
      })
    },
    selectRuntimeMode: async (runtimeMode) => {
      setRuntimeMode(draftTarget, runtimeMode)
      if (!sessionId) return true

      return dispatchModeSet({
        command: createRuntimeModeSetCommand({
          runtimeMode,
          sessionId,
        }),
        context: { runtimeMode },
        dispatchCommand,
      })
    },
  }

  return <ChatComposerModesContext value={value}>{children}</ChatComposerModesContext>
}

async function dispatchModeSet({
  command,
  context,
  dispatchCommand,
}: {
  command: ModeSetCommand
  context: Record<string, unknown>
  dispatchCommand: DispatchCommand
}): Promise<boolean> {
  // Nothing is rolled back: the draft override keeps the next turn correct
  // even when the session-level sync never lands.
  const outcome = await dispatchChatCommand({
    action: 'chat.session_mode.set.summary',
    command,
    context,
    dispatchCommand,
  })

  return outcome.ok
}
