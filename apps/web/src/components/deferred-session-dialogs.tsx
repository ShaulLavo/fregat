import { DeferredOverlay } from '@/components/deferred-overlay'
import { sessionDialogsModuleQueryOptions } from '@/components/utils/overlay-modules'
import { useSessionDeleteRequestStore } from '@/features/chat-mode/state/session-delete-request-store'
import { useSessionSnoozeRequestStore } from '@/features/chat-mode/state/session-snooze-request-store'
import { useWorktreeManagerStore } from '@/features/chat-mode/state/worktree-manager-store'

/** The session action dialogs, downloaded when one first opens or when the page is idle. */
export function DeferredSessionDialogs() {
  const deleting = useSessionDeleteRequestStore((state) => state.request !== null)
  const snoozing = useSessionSnoozeRequestStore((state) => state.request !== null)
  const managing = useWorktreeManagerStore((state) => state.project !== null)

  return (
    <DeferredOverlay
      label='session dialog'
      module={sessionDialogsModuleQueryOptions}
      open={deleting || snoozing || managing}
      onClose={closeSessionDialogs}
    >
      {({ SessionDialogs }) => <SessionDialogs />}
    </DeferredOverlay>
  )
}

function closeSessionDialogs() {
  useSessionDeleteRequestStore.getState().dismissDelete()
  useSessionSnoozeRequestStore.getState().dismiss()
  useWorktreeManagerStore.getState().closeManager()
}
