import { useCallback } from 'react'

import { useCommand } from '@/keymap/hooks/use-command'
import { log } from '@/lib/client-logging'

import type { TerminalContextSelection } from '@workspace/client-core/chat/terminal-context'
import { useChatInputDraftStore } from '../state/chat-input-draft-store'
import { useComposerInboxStore } from '../state/composer-inbox-store'
import { useSidebarSelectionStore } from '../state/sidebar-selection-store'

/**
 * The one action a capture surface anywhere in the app calls to put something in
 * the composer and bring the composer on screen.
 *
 * Narrow on purpose: surfaces hand over *what* they captured and nothing else.
 * They do not learn which session is open, they do not touch the draft store, and
 * they never hold a reference to the editor — which is what stops each new
 * capture surface growing a handle of its own.
 */
export function useAttachToComposer() {
  const { bus } = useCommand()

  const reveal = useCallback(
    (source: string, detail: Record<string, unknown>) => {
      // After queueing: in the workbench this is what mounts the composer that
      // drains the inbox.
      const ticket = bus.dispatch('workspace.revealChat', {
        source: { caller: 'chat.attach-to-composer', kind: 'programmatic' },
      })

      void ticket.completion.then((outcome) => {
        log.info({
          action: 'chat.composer_attach',
          area: 'chat',
          claimed: ticket.claimed,
          revealOutcome: outcome.status,
          source,
          ...detail,
        })
      })
    },
    [bus],
  )

  const attachTerminalContext = useCallback(
    (selection: TerminalContextSelection | null) => {
      if (!selection) return false

      const queued = useComposerInboxStore.getState().queueTerminalContext(selection)
      if (!queued) return false

      reveal('terminal', {
        lineEnd: queued.lineEnd,
        lineStart: queued.lineStart,
        // The captured output is user content and stays off the event; its size
        // is what explains a slow send or a rejected message.
        textLength: queued.text.length,
      })

      return true
    },
    [reveal],
  )

  const attachText = useCallback(
    (source: string, text: string) => {
      if (!useComposerInboxStore.getState().queueText(text)) return false

      reveal(source, { textLength: text.trim().length })

      return true
    },
    [reveal],
  )

  /**
   * For work that is its own conversation: the text goes to a fresh draft, not
   * into whichever session happens to be open.
   *
   * Written to the draft's stored prompt rather than queued for an editor: the
   * composer of a draft that is still settling is replaced once or twice, and
   * text spliced into a replaced editor is lost. Every composer syncs from the
   * store, so the prompt survives however it mounts.
   */
  const attachTextToNewChat = useCallback(
    async (source: string, text: string, rootPath: string) => {
      if (text.trim().length === 0) return false

      const before = sidebarDraftId()
      const ticket = bus.dispatch('workspace.newChat', {
        source: { caller: 'chat.attach-to-composer', kind: 'programmatic' },
      })
      const outcome = await ticket.completion
      if (outcome.status !== 'handled') {
        log.warn({ action: 'chat.composer_attach', area: 'chat', newChat: outcome.status, source })
        return false
      }

      const selection = useSidebarSelectionStore.getState().selection
      const draftId = sidebarDraftId()
      // Chat mode selects its draft elsewhere; the inbox still reaches that composer.
      if (selection.kind !== 'draft' || !draftId || draftId === before)
        return attachText(source, text)

      useChatInputDraftStore
        .getState()
        .setPrompt({ draftKey: draftId, environmentId: selection.environmentId, rootPath }, text)
      reveal(source, { newChat: true, textLength: text.trim().length })
      return true
    },
    [attachText, bus, reveal],
  )

  return { attachTerminalContext, attachText, attachTextToNewChat }
}

function sidebarDraftId() {
  const { selection } = useSidebarSelectionStore.getState()
  return selection.kind === 'draft' ? (selection.draftId ?? null) : null
}
