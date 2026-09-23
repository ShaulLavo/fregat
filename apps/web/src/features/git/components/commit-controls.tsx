import { useStatus } from '@/features/git/hooks/use-status'
import { useReconcileCommitProgress } from '@/features/git/hooks/use-reconcile-commit-progress'
import { TickerText } from '@/components/ticker-text'
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
import { OrbitLoader } from '@workspace/ui/components/orbit-loader'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { useId, type ChangeEvent, type KeyboardEvent } from 'react'

import { useCommitAction } from '@/features/git/hooks/use-commit-action'
import { useGenerateCommitMessage } from '@/features/git/hooks/use-generate-commit-message'
import { useSyncChangesMutation } from '@/features/git/hooks/use-sync-changes-mutation'
import { CommitProgress } from './commit-progress'
import { FailureNotice } from './failure-notice'

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
  useReconcileCommitProgress(rootPath)
  const confirmed = Boolean(useStatus(rootPath).data)
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
    if (!confirmed || showSyncChanges) return
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
      <PaneBar>
        <InputGroup className='h-(--density-control-height-sm) min-w-0 flex-1'>
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
            <Tooltip>
              <TooltipTrigger
                render={
                  <InputGroupButton
                    aria-busy={generation.isPending}
                    aria-label={generationLabel}
                    disabled={
                      !confirmed ||
                      generation.isCancelling ||
                      (inputDisabled && !generation.isPending)
                    }
                    focusableWhenDisabled
                    onClick={generation.generateOrCancel}
                    size='icon-xs'
                  >
                    {generation.isPending ? (
                      <OrbitLoader aria-hidden='true' role='presentation' />
                    ) : (
                      <SparkleIcon aria-hidden='true' />
                    )}
                  </InputGroupButton>
                }
              />
              <TooltipContent>{generationLabel}</TooltipContent>
            </Tooltip>
          </InputGroupAddon>
        </InputGroup>
        {showSyncChanges ? (
          <Button
            className='shrink-0 tabular-nums'
            disabled={!confirmed || syncChanges.isPending}
            onClick={() => syncChanges.mutate()}
            size='sm'
            type='button'
            variant='default'
          >
            {syncChanges.isPending ? (
              <OrbitLoader aria-hidden='true' role='presentation' />
            ) : (
              <ArrowsClockwiseIcon className='size-(--icon-size-sm)' />
            )}
            <TickerText text={syncChangesLabel(repository)} />
          </Button>
        ) : (
          <Button
            className='shrink-0'
            disabled={!confirmed || commit.isPending}
            onClick={commit.submit}
            size='sm'
            title={`Commit to ${repository.branch ?? 'HEAD'}`}
            type='button'
            variant='default'
          >
            {commit.isPending ? (
              <OrbitLoader aria-hidden='true' />
            ) : (
              <CheckIcon className='size-(--icon-size-sm)' />
            )}
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
      <FailureNotice rootPath={rootPath} />
    </>
  )
}
