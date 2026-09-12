import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { Input } from '@workspace/ui/components/input'
import { useState } from 'react'

import { createProjectMetaCommand } from '@workspace/client-core/chat/commands'
import { dispatchChatCommand } from '@/features/chat/utils/command-dispatch'
import { notifyChatCommandError } from '@/features/chat/notify-command-error'
import { dispatchCommandForEnvironment } from '@/features/chat/state/active-transports'
import { scopedProjectKey } from '@workspace/contracts'
import { useProjectRenameRequestStore } from '@/features/chat-mode/state/project-rename-request-store'

/**
 * Renaming a project was impossible: the server accepted `title` and nothing
 * ever sent it, so the only way to fix a name was to delete the project —
 * cascading every session — and add the folder again.
 */
export function ProjectRenameDialog() {
  const request = useProjectRenameRequestStore((state) => state.request)
  const dismissRename = useProjectRenameRequestStore((state) => state.dismissRename)
  // Keyed on the request so opening the dialog for a second project starts from
  // that project's name rather than the previous one's edited text.
  const [title, setTitle] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  if (request && editingId !== scopedProjectKey(request.ref)) {
    setEditingId(scopedProjectKey(request.ref))
    setTitle(request.title)
  }

  const trimmed = title.trim()
  const canSave = trimmed.length > 0 && trimmed !== request?.title

  async function save() {
    if (!request || !canSave || saving) return

    setSaving(true)
    try {
      const outcome = await dispatchChatCommand({
        action: 'chat.project.rename',
        command: createProjectMetaCommand({ projectId: request.ref.projectId, title: trimmed }),
        dispatchCommand: (command) =>
          dispatchCommandForEnvironment(request.ref.environmentId, command),
      })
      if (!outcome.ok) {
        // Closing on dispatch rather than on the result told the user the rename
        // landed; the old name then came back on the next projection sync with no
        // explanation.
        notifyChatCommandError(outcome.error, 'Could not rename the project')
        return
      }

      dismissRename()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog onOpenChange={(open) => open || dismissRename()} open={request !== null}>
      <DialogContent
        className='w-[min(420px,calc(100vw-2rem))] max-w-none border text-sm sm:max-w-none'
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>Rename project</DialogTitle>
        </DialogHeader>
        <Input
          aria-label='Project name'
          autoFocus
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return

            event.preventDefault()
            void save()
          }}
          value={title}
        />
        <DialogFooter>
          <Button onClick={() => dismissRename()} type='button' variant='outline'>
            Cancel
          </Button>
          <Button disabled={!canSave || saving} onClick={() => void save()} type='button'>
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
