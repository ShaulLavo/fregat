import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { Input } from '@workspace/ui/components/input'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { createProjectMetaCommand } from '@workspace/client-core/chat/commands'
import { dispatchChatCommand } from '@/features/chat/utils/command-dispatch'
import { notifyChatCommandError } from '@/features/chat/notify-command-error'
import { dispatchCommandForEnvironment } from '@/features/chat/state/active-transports'
import { scopedProjectKey, type EnvironmentId, type ProjectId } from '@workspace/contracts'
import { useProjectRenameRequestStore } from '@/features/chat-mode/state/project-rename-request-store'
import { chatModeMutationKeys } from '@/features/chat-mode/utils/mutation-keys'

type RenameVariables = {
  readonly environmentId: EnvironmentId
  readonly projectId: ProjectId
  readonly title: string
}

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
  // Closing on dispatch rather than on the result told the user the rename
  // landed; the old name then came back on the next projection sync with no
  // explanation.
  const rename = useMutation({
    mutationFn: async ({ projectId, environmentId, title }: RenameVariables) => {
      const outcome = await dispatchChatCommand({
        action: 'chat.project.rename',
        command: createProjectMetaCommand({ projectId, title }),
        dispatchCommand: (command) => dispatchCommandForEnvironment(environmentId, command),
      })
      if (!outcome.ok) throw outcome.error
      return outcome.result
    },
    mutationKey: chatModeMutationKeys.projectRename(),
    onError: (error) => notifyChatCommandError(error, 'Could not rename the project'),
    onSuccess: () => dismissRename(),
  })
  if (request && editingId !== scopedProjectKey(request.ref)) {
    setEditingId(scopedProjectKey(request.ref))
    setTitle(request.title)
  }

  const trimmed = title.trim()
  const canSave = trimmed.length > 0 && trimmed !== request?.title

  function save() {
    if (!request || !canSave || rename.isPending) return
    rename.mutate({
      environmentId: request.ref.environmentId,
      projectId: request.ref.projectId,
      title: trimmed,
    })
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
          autoCapitalize='off'
          autoComplete='off'
          autoCorrect='off'
          autoFocus
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return

            event.preventDefault()
            save()
          }}
          spellCheck={false}
          value={title}
        />
        <DialogFooter>
          <Button onClick={() => dismissRename()} type='button' variant='outline'>
            Cancel
          </Button>
          <Button disabled={!canSave || rename.isPending} onClick={save} type='button'>
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
