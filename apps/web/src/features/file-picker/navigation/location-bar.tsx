import { ArrowRightIcon, PencilSimpleIcon, XIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { Spinner } from '@workspace/ui/components/spinner'
import type { FormEvent, KeyboardEvent, RefObject } from 'react'

import { IconTooltip } from '@/features/file-picker/icon-tooltip'
import { Breadcrumbs } from '@/features/file-picker/navigation/breadcrumbs'

export function LocationBar({
  currentPath,
  draft,
  error,
  inputRef,
  isEditing,
  isPending,
  onCancel,
  onChange,
  onEdit,
  onSubmit,
}: {
  currentPath: string
  draft: string
  error: string | null
  inputRef: RefObject<HTMLInputElement | null>
  isEditing: boolean
  isPending: boolean
  onCancel: () => void
  onChange: (value: string) => void
  onEdit: () => void
  onSubmit: () => void
}) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void onSubmit()
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return

    event.preventDefault()
    void onSubmit()
  }

  if (!isEditing) {
    return (
      <div className='border-input bg-background flex min-w-0 items-center gap-1 rounded-md border px-1 py-0.5'>
        <Breadcrumbs currentPath={currentPath} />
        <IconTooltip label='Go to folder (⌘⇧G)'>
          <Button
            aria-label='Go to folder'
            className='shrink-0'
            onClick={onEdit}
            size='icon-xs'
            type='button'
            variant='ghost'
          >
            <PencilSimpleIcon />
          </Button>
        </IconTooltip>
      </div>
    )
  }

  return (
    <form className='min-w-0' onSubmit={handleSubmit}>
      <div className='flex min-w-0 items-center gap-1'>
        <Input
          ref={inputRef}
          aria-describedby={error ? 'file-picker-path-error' : undefined}
          aria-invalid={Boolean(error)}
          aria-label='Folder path'
          className='min-w-0 font-mono'
          disabled={isPending}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleInputKeyDown}
          spellCheck={false}
          value={draft}
        />
        <IconTooltip label='Open folder'>
          <Button
            aria-label='Open folder path'
            disabled={isPending}
            size='icon-sm'
            type='submit'
            variant='secondary'
          >
            {isPending ? <Spinner className='size-3.5' /> : <ArrowRightIcon />}
          </Button>
        </IconTooltip>
        <IconTooltip label='Cancel path entry'>
          <Button
            aria-label='Cancel path entry'
            onClick={onCancel}
            size='icon-sm'
            type='button'
            variant='ghost'
          >
            <XIcon />
          </Button>
        </IconTooltip>
      </div>
      {error ? (
        <p className='text-destructive text-2xs mt-1' id='file-picker-path-error' role='alert'>
          {error}
        </p>
      ) : null}
    </form>
  )
}
