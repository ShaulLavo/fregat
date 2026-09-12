import type { GitRepositoryInfo } from '@workspace/contracts'
import { ArrowsClockwiseIcon, CheckIcon, SparkleIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@workspace/ui/components/input-group'
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
      <div className='shrink-0 px-(--density-row-padding-x) pt-(--density-section-gap)'>
        <InputGroup className='bg-background'>
          <InputGroupInput
            aria-label='Commit message'
            aria-describedby={generation.error ? generationErrorId : undefined}
            aria-invalid={generation.error ? true : undefined}
            className='h-full text-xs font-medium'
            disabled={inputDisabled}
            onChange={handleMessageChange}
            onKeyDown={handleCommitKeyDown}
            placeholder={`Commit Changes (⌘↵ on "${repository.branch ?? 'HEAD'}")`}
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
        {generation.error ? (
          <p className='text-destructive mt-1 text-xs' id={generationErrorId} role='alert'>
            {generation.error}
          </p>
        ) : null}
      </div>
      <div className='shrink-0 px-(--density-row-padding-x) pt-(--density-section-padding)'>
        {showSyncChanges ? (
          <Button
            className='w-full text-sm tabular-nums'
            disabled={syncChanges.isPending}
            onClick={() => syncChanges.mutate()}
            type='button'
            variant='default'
          >
            <ArrowsClockwiseIcon
              className={[
                'size-4',
                syncChanges.isPending ? 'animate-spin motion-reduce:animate-none' : '',
              ].join(' ')}
            />
            {syncChangesLabel(repository)}
          </Button>
        ) : (
          <Button
            className='w-full text-sm'
            disabled={commit.isPending}
            onClick={commit.submit}
            type='button'
            variant='default'
          >
            <CheckIcon className='size-4' />
            Commit
            <span className='text-primary-foreground/65'>⌘↵</span>
          </Button>
        )}
      </div>
      <CommitProgress rootPath={rootPath} />
    </>
  )
}
