import { useChatTransport } from '@/features/chat/hooks/use-chat-transport'
import { CaretRightIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'
import { useState } from 'react'

import { errorMessage } from '@/lib/error-message'
import {
  changedFileName,
  selectChangedFilePreview,
  shouldAutoExpandChangedFiles,
  summarizeChangedFileScopes,
} from '@/features/chat/utils/changed-files-presentation'
import {
  checkpointAvailability,
  checkpointAvailabilityLabel,
  type CheckpointAvailability,
} from '@/lib/checkpoint-availability'
import {
  hasNonZeroChatTurnDiffStat,
  summarizeChatTurnDiffStats,
} from '@/features/chat/utils/turn-diff-tree'
import { useChatTimelineActions } from '../hooks/use-chat-timeline-actions'
import {
  chatChangedFilesExpansionKey,
  useChatChangedFilesExpansionStore,
} from '../state/chat-changed-files-expansion-store'
import type { ChatTurnDiffSummary } from '@workspace/client-core/chat/types'
import { AssistantChangedFilesTree } from './assistant-changed-files-tree'
import { DiffStatLabel } from '@/components/diff-stat-label'

export function AssistantChangedFilesSection({ summary }: { summary: ChatTurnDiffSummary }) {
  const { openCheckpointDiff, openSessionCheckpointDiff } = useChatTimelineActions()
  const { environmentId } = useChatTransport()
  const expansionKey = chatChangedFilesExpansionKey(environmentId, summary)
  const expansion = useChatChangedFilesExpansionStore((state) => state.expansionByKey[expansionKey])
  const setCardExpanded = useChatChangedFilesExpansionStore((state) => state.setCardExpanded)
  const setDirectoriesExpanded = useChatChangedFilesExpansionStore(
    (state) => state.setDirectoriesExpanded,
  )
  const [diffError, setDiffError] = useState<string | null>(null)
  const files = summary.files
  const availability = checkpointAvailability(summary)
  // A failed or missing capture has no files; it still says so rather than vanishing.
  if (files.length === 0) return unlistedCheckpoint(availability)

  const summaryStat = summarizeChatTurnDiffStats(files)
  const expanded = expansion?.cardExpanded ?? shouldAutoExpandChangedFiles(files)
  const allDirectoriesExpanded = expansion?.directoriesExpanded ?? true
  const diffAvailable = availability.kind === 'available'

  async function handleOpenCheckpointDiff(path?: string) {
    if (!diffAvailable) return

    setDiffError(null)
    try {
      await openCheckpointDiff(summary, path)
    } catch (error) {
      setDiffError(errorMessage(error, 'Checkpoint diff unavailable.'))
    }
  }

  async function handleOpenSessionDiff() {
    if (!diffAvailable) return

    setDiffError(null)
    try {
      await openSessionCheckpointDiff(summary)
    } catch (error) {
      setDiffError(errorMessage(error, 'Checkpoint diff unavailable.'))
    }
  }

  return (
    <section
      className='bg-card/45 @container/changed-files mt-2 rounded-lg p-2.5'
      data-changed-files-state={expanded ? 'expanded' : 'preview'}
    >
      {/* Wraps rather than letting the counts overlap the actions when the stage is narrow. */}
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <Button
          aria-expanded={expanded}
          className='h-auto flex-1 justify-start gap-1.5 py-1 pr-1 pl-0 text-left font-normal @max-2xs/changed-files:min-w-0'
          data-scroll-anchor-ignore
          size='sm'
          type='button'
          variant='ghost'
          onClick={() => setCardExpanded(expansionKey, !expanded)}
        >
          <CaretRightIcon
            aria-hidden='true'
            className={cn(
              'text-muted-foreground size-(--icon-size-sm) shrink-0 transition-transform',
              expanded && 'rotate-90',
            )}
          />
          <span className='text-muted-foreground section-label truncate'>
            <span className='font-mono tabular-nums'>{files.length}</span>
            {files.length === 1 ? ' changed file' : ' changed files'}
          </span>
          {hasNonZeroChatTurnDiffStat(summaryStat) ? (
            <span className='text-3xs shrink-0 font-mono @max-2xs/changed-files:hidden'>
              <DiffStatLabel
                live
                size='3xs'
                additions={summaryStat.additions}
                deletions={summaryStat.deletions}
              />
            </span>
          ) : null}
        </Button>
        <div className='flex flex-wrap items-center gap-1.5'>
          {diffAvailable ? (
            <Button
              data-scroll-anchor-ignore
              size='xs'
              type='button'
              variant='outline'
              onClick={() => void handleOpenCheckpointDiff()}
            >
              View diff
            </Button>
          ) : (
            <span className='text-muted-foreground text-3xs'>
              {checkpointAvailabilityLabel(availability)}
            </span>
          )}
          {diffAvailable ? (
            <Button
              data-scroll-anchor-ignore
              size='xs'
              type='button'
              variant='outline'
              onClick={() => void handleOpenSessionDiff()}
            >
              Session diff
            </Button>
          ) : null}
          {expanded ? (
            <Button
              data-scroll-anchor-ignore
              size='xs'
              type='button'
              variant='outline'
              onClick={() => setDirectoriesExpanded(expansionKey, !allDirectoriesExpanded)}
            >
              {allDirectoriesExpanded ? 'Collapse all' : 'Expand all'}
            </Button>
          ) : null}
        </div>
      </div>
      {expanded ? (
        <div className='mt-1.5'>
          <AssistantChangedFilesTree
            allDirectoriesExpanded={allDirectoriesExpanded}
            files={files}
            key={`changed-files-tree:${summary.turnId}`}
            onOpenFileDiff={diffAvailable ? handleOpenCheckpointDiff : undefined}
          />
        </div>
      ) : null}
      {expanded ? null : (
        <div className='mt-1'>
          <p className='text-muted-foreground text-2xs flex flex-wrap items-center gap-x-1.5'>
            {summarizeChangedFileScopes(files).map((scope, index) => (
              <span className='inline-flex items-center gap-1' key={scope.label}>
                {index > 0 ? <span aria-hidden='true'>·</span> : null}
                <span className='text-foreground font-mono'>{scope.label}</span>
                <span className='font-mono tabular-nums'>{scope.fileCount}</span>
                <span>{scope.fileCount === 1 ? 'file' : 'files'}</span>
              </span>
            ))}
          </p>
          <div className='mt-1.5 flex flex-wrap items-center gap-1.5'>
            {selectChangedFilePreview(files).map((file) => (
              <Button
                className='text-muted-foreground text-3xs max-w-48 px-1.5 font-mono'
                data-scroll-anchor-ignore
                disabled={!diffAvailable}
                key={file.path}
                size='xs'
                title={file.path}
                type='button'
                variant='outline'
                onClick={() => void handleOpenCheckpointDiff(file.path)}
              >
                <span className='truncate'>{changedFileName(file.path)}</span>
              </Button>
            ))}
            <Button
              className='text-muted-foreground text-2xs px-1.5'
              data-scroll-anchor-ignore
              size='xs'
              type='button'
              variant='ghost'
              onClick={() => setCardExpanded(expansionKey, true)}
            >
              Show all <span className='tabular-nums'>{files.length}</span> files
            </Button>
          </div>
        </div>
      )}
      {diffError ? <p className='text-destructive text-2xs mt-1.5'>{diffError}</p> : null}
    </section>
  )
}

/** A turn that changed nothing shows nothing; a capture that failed says which way it failed. */
function unlistedCheckpoint(availability: CheckpointAvailability) {
  if (availability.kind !== 'missing' && availability.kind !== 'error') return null

  return (
    <p
      className={cn(
        'text-2xs mt-2',
        availability.kind === 'error' ? 'text-destructive' : 'text-muted-foreground',
      )}
      data-changed-files-state={availability.kind}
    >
      {checkpointAvailabilityLabel(availability)}
    </p>
  )
}
