import { log } from '@/lib/client-logging'
import type { ComposerAttach, ComposerDestination } from '@/lib/composer-attach/providers/context'
import type { PlatformCommandBus } from '@/keymap/providers/command-context'

import type { TerminalContextSelection } from '@workspace/client-core/chat/terminal-context'
import { getNavigation } from '@/state/navigation-binding'
import { useComposerInboxStore } from './composer-inbox-store'

/**
 * Chat's side of the attach seam: queue the capture for its workspace's composer and bring
 * the composer on screen. Built once per command bus, for React surfaces and commands alike.
 */
export function createComposerAttach(bus: Pick<PlatformCommandBus, 'dispatch'>): ComposerAttach {
  const reveal = (
    source: string,
    destination: ComposerDestination,
    detail: Record<string, unknown>,
  ) => {
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
        environmentId: destination.environmentId,
        revealOutcome: outcome.status,
        source,
        ...detail,
      })
    })
  }

  const attachTerminalContext = (
    selection: TerminalContextSelection | null,
    destination: ComposerDestination,
  ) => {
    if (!selection) return false

    const queued = useComposerInboxStore.getState().queueTerminalContext(selection, destination)
    if (!queued) return false

    reveal('terminal', destination, {
      lineEnd: queued.lineEnd,
      lineStart: queued.lineStart,
      // The captured output is user content and stays off the event; its size
      // is what explains a slow send or a rejected message.
      textLength: queued.text.length,
    })

    return true
  }

  const attachText = (source: string, text: string, destination: ComposerDestination) => {
    if (!useComposerInboxStore.getState().queueText(text, destination)) return false

    reveal(source, destination, { textLength: text.trim().length })

    return true
  }

  // Persist before navigation so replacing the mounted composer preserves the prompt.
  const attachTextToNewChat = async (
    source: string,
    text: string,
    destination: ComposerDestination,
  ) => {
    if (text.trim().length === 0) return false

    const opened = await getNavigation().startComposerDraft(destination, text)
    log.info({
      action: 'chat.composer_attach',
      area: 'chat',
      source,
      environmentId: destination.environmentId,
      newChat: opened,
      textLength: text.trim().length,
    })
    return opened
  }

  return { attachTerminalContext, attachText, attachTextToNewChat }
}
