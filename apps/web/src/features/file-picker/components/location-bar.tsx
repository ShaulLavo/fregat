import { ArrowRightIcon, PencilSimpleIcon, XIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@workspace/ui/components/input-group'
import { Spinner } from '@workspace/ui/components/spinner'
import type { FormEvent, KeyboardEvent, RefObject } from 'react'

import { IconTooltip } from '@/features/file-picker/components/icon-tooltip'
import { Breadcrumbs } from '@/features/file-picker/components/breadcrumbs'

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
      <div className='bg-background flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5'>
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
      <InputGroup>
        <InputGroupInput
          ref={inputRef}
          aria-describedby={error ? 'file-picker-path-error' : undefined}
          aria-invalid={Boolean(error)}
          aria-label='Folder path'
          autoCapitalize='off'
          autoComplete='off'
          autoCorrect='off'
          className='font-meta'
          disabled={isPending}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleInputKeyDown}
          spellCheck={false}
          value={draft}
        />
        <InputGroupAddon align='inline-end'>
          {isPending ? (
            <span aria-live='polite' className='sr-only' role='status'>
              Opening folder…
            </span>
          ) : null}
          <IconTooltip label='Open folder'>
            <InputGroupButton
              aria-busy={isPending}
              aria-label='Open folder path'
              disabled={isPending}
              focusableWhenDisabled
              size='icon-sm'
              type='submit'
              variant='secondary'
            >
              {isPending ? (
                <Spinner aria-hidden='true' role='presentation' />
              ) : (
                <ArrowRightIcon aria-hidden='true' />
              )}
            </InputGroupButton>
          </IconTooltip>
          <IconTooltip label='Cancel path entry'>
            <InputGroupButton
              aria-label='Cancel path entry'
              onClick={onCancel}
              size='icon-sm'
              type='button'
              variant='ghost'
            >
              <XIcon aria-hidden='true' />
            </InputGroupButton>
          </IconTooltip>
        </InputGroupAddon>
      </InputGroup>
      {error ? (
        <p className='text-destructive text-2xs mt-1' id='file-picker-path-error' role='alert'>
          {error}
        </p>
      ) : null}
    </form>
  )
}
