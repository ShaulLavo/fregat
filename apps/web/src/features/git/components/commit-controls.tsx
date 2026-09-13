import type { GitRepositoryInfo } from '@workspace/contracts'
import { ArrowsClockwiseIcon, CheckIcon, SparkleIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@workspace/ui/components/input-group'
import { PaneBar } from '@workspace/ui/components/pane-bar'
import { Spinner } from '@workspace/ui/components/spinner'
import { useId, type ChangeEvent, type KeyboardEvent } from 'react'

import { useCommitAction } from '@/features/git/hooks/use-commit-action'
import { useGenerateCommitMessage } from '@/features/git/hooks/use-generate-commit-message'
import { useSyncChangesMutation } from '@/features/git/hooks/use-sync-changes-mutation'
import { CommitProgress } from './commit-progress'

import { canSyncChanges, syncChangesLabel } from '../utils/repository'

export function CommitControls({
  hasLocalChanges,
  repository,
  rootPath,
}: {
  hasLocalChanges: boolean
  repository: GitRepositoryInfo
  rootPath: string
}) {
  const commit = useCommitAction(rootPath)
  const generation = useGenerateCommitMessage(rootPath)
  const syncChanges = useSyncChangesMutation(rootPath)
  const showSyncChanges = canSyncChanges(repository, hasLocalChanges)
  const inputDisabled = commit.isPending || syncChanges.isPending || showSyncChanges
  const generationErrorId = useId()
  let generationLabel = 'Generate commit message'
  if (generation.isPending) generationLabel = 'Cancel commit message generation'
  if (generation.isCancelling) generationLabel = 'Cancelling commit message…'
  let generationStatus = 'Generating commit message…'
  if (generation.isCancelling) generationStatus = 'Cancelling commit message…'

  function handleCommitKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (showSyncChanges) return
    if (!event.metaKey && !event.ctrlKey) return
    if (event.key !== 'Enter') return

    event.preventDefault()
    commit.submit()
  }

  function handleMessageChange(event: ChangeEvent<HTMLInputElement>) {
    generation.clearError()
    commit.setMessage(event.currentTarget.value)
  }

  return (
    <>
      <PaneBar border='bottom'>
        <InputGroup className='bg-background h-(--density-control-height-sm) min-w-0 flex-1'>
          <InputGroupInput
            aria-label='Commit message'
            aria-describedby={generation.error ? generationErrorId : undefined}
            aria-invalid={generation.error ? true : undefined}
            className='h-full text-xs font-medium'
            disabled={inputDisabled}
            onChange={handleMessageChange}
            onKeyDown={handleCommitKeyDown}
            placeholder='Commit message'
            value={showSyncChanges ? '' : commit.message}
          />
          <InputGroupAddon align='inline-end'>
            {generation.isPending ? (
              <span aria-live='polite' className='sr-only' role='status'>
                {generationStatus}
              </span>
            ) : null}
            <InputGroupButton
              aria-busy={generation.isPending}
              aria-label={generationLabel}
              disabled={generation.isCancelling || (inputDisabled && !generation.isPending)}
              onClick={generation.generateOrCancel}
              size='icon-xs'
            >
              {generation.isPending ? (
                <Spinner aria-hidden='true' role='presentation' />
              ) : (
                <SparkleIcon aria-hidden='true' />
              )}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        {showSyncChanges ? (
          <Button
            className='shrink-0 tabular-nums'
            disabled={syncChanges.isPending}
            onClick={() => syncChanges.mutate()}
            size='sm'
            type='button'
            variant='default'
          >
            {syncChanges.isPending ? (
              <Spinner aria-hidden='true' role='presentation' />
            ) : (
              <ArrowsClockwiseIcon className='size-3.5' />
            )}
            {syncChangesLabel(repository)}
          </Button>
        ) : (
          <Button
            className='shrink-0'
            disabled={commit.isPending}
            onClick={commit.submit}
            size='sm'
            title={`Commit to ${repository.branch ?? 'HEAD'}`}
            type='button'
            variant='default'
          >
            <CheckIcon className='size-3.5' />
            Commit
            <span className='text-primary-foreground/65 text-3xs'>⌘↵</span>
          </Button>
        )}
      </PaneBar>
      {generation.error ? (
        <p
          className='text-destructive px-(--bar-padding-x) py-(--density-gap-tight) text-xs'
          id={generationErrorId}
          role='alert'
        >
          {generation.error}
        </p>
      ) : null}
      <CommitProgress rootPath={rootPath} />
    </>
  )
}
