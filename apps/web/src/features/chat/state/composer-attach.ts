import { log } from '@/lib/client-logging'
import type { ComposerAttach, ComposerDestination } from '@/lib/composer-attach/providers/context'
import type { PlatformCommandBus } from '@/keymap/providers/command-context'

import type { TerminalContextSelection } from '@workspace/client-core/chat/terminal-context'
import { useChatInputDraftStore } from './chat-input-draft-store'
import { useComposerInboxStore } from './composer-inbox-store'
import { useSidebarSelectionStore } from './sidebar-selection-store'

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

  /**
   * Written to the draft's stored prompt rather than queued for an editor: the
   * composer of a draft that is still settling is replaced once or twice, and
   * text spliced into a replaced editor is lost. Every composer syncs from the
   * store, so the prompt survives however it mounts.
   */
  const attachTextToNewChat = async (
    source: string,
    text: string,
    destination: ComposerDestination,
  ) => {
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
    // Chat mode selects its draft elsewhere, and a draft on another machine is not this
    // capture's; the inbox still reaches the right composer.
    if (
      selection.kind !== 'draft' ||
      !draftId ||
      draftId === before ||
      selection.environmentId !== destination.environmentId
    )
      return attachText(source, text, destination)

    useChatInputDraftStore.getState().setPrompt(
      {
        draftKey: draftId,
        environmentId: destination.environmentId,
        rootPath: destination.rootPath,
      },
      text,
    )
    reveal(source, destination, { newChat: true, textLength: text.trim().length })
    return true
  }

  return { attachTerminalContext, attachText, attachTextToNewChat }
}

function sidebarDraftId() {
  const { selection } = useSidebarSelectionStore.getState()
  return selection.kind === 'draft' ? (selection.draftId ?? null) : null
}
