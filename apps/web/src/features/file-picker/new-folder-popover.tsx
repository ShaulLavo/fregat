import type { FsEntry } from '@/lib/file-system-types'
import { errorMessage } from '@/lib/error-message'
import { FolderPlusIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@workspace/ui/components/popover'
import { Spinner } from '@workspace/ui/components/spinner'
import { useState, type FormEvent } from 'react'

import { folderNameError } from '@/features/file-picker/data-helpers'
import { displayPath } from '@/features/file-picker/model'
import { useCreateFolderMutation } from '@/features/file-picker/use-create-folder-mutation'

export function NewFolderPopover({
  currentPath,
  onCreated,
}: {
  currentPath: string
  onCreated: (entry: FsEntry) => void
}) {
  const mutation = useCreateFolderMutation()
  const [name, setName] = useState('')
  const [open, setOpen] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const requestError = mutation.isError
    ? errorMessage(mutation.error, 'Could not create the folder.')
    : null
  const displayedError = validationError ?? requestError

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) return

    setName('')
    setValidationError(null)
    mutation.reset()
  }

  function handleNameChange(nextName: string) {
    setName(nextName)
    setValidationError(null)
    mutation.reset()
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const invalid = folderNameError(name)
    if (invalid) {
      setValidationError(invalid)
      return
    }

    mutation.mutate(
      { name, parentPath: currentPath },
      {
        onSuccess: (entry) => {
          onCreated(entry)
          setOpen(false)
        },
      },
    )
  }

  return (
    <Popover onOpenChange={handleOpenChange} open={open}>
      <PopoverTrigger
        render={
          <Button
            aria-label='New folder'
            size='icon-sm'
            title='New folder'
            type='button'
            variant='ghost'
          >
            <FolderPlusIcon />
          </Button>
        }
      />
      <PopoverContent align='end' className='w-80' side='bottom'>
        <PopoverHeader>
          <PopoverTitle>New folder</PopoverTitle>
          <PopoverDescription>{`Create inside ${displayPath(currentPath)}.`}</PopoverDescription>
        </PopoverHeader>
        <form className='space-y-(--density-control-gap)' onSubmit={handleSubmit}>
          <Input
            autoFocus
            aria-describedby={displayedError ? 'file-picker-new-folder-error' : undefined}
            aria-invalid={Boolean(displayedError)}
            aria-label='Folder name'
            autoCapitalize='off'
            autoComplete='off'
            autoCorrect='off'
            disabled={mutation.isPending}
            onChange={(event) => handleNameChange(event.target.value)}
            placeholder='Untitled folder'
            spellCheck={false}
            value={name}
          />
          {displayedError ? (
            <p className='text-destructive text-2xs' id='file-picker-new-folder-error' role='alert'>
              {displayedError}
            </p>
          ) : null}
          <div className='flex justify-end gap-(--density-control-gap)'>
            <Button
              disabled={mutation.isPending}
              onClick={() => setOpen(false)}
              size='sm'
              type='button'
              variant='ghost'
            >
              Cancel
            </Button>
            <Button disabled={mutation.isPending} size='sm' type='submit'>
              {mutation.isPending ? <Spinner data-icon='inline-start' /> : <FolderPlusIcon />}
              Create
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
