import { useCallback } from 'react'

import { useCommand } from '@/keymap/hooks/use-command'
import { log } from '@/lib/client-logging'

import type { TerminalContextSelection } from '@workspace/client-core/chat/terminal-context'
import { useComposerInboxStore } from '../state/composer-inbox-store'

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

  return { attachTerminalContext, attachText }
}
