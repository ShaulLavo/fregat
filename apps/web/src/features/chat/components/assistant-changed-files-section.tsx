import { useChatTransport } from '@/features/chat/hooks/use-chat-transport'
import { CaretRightIcon } from '@phosphor-icons/react'
import { cn } from '@workspace/ui/lib/utils'
import { useState } from 'react'

import { errorMessage } from '@/lib/error-message'
import {
  changedFileName,
  selectChangedFilePreview,
  shouldAutoExpandChangedFiles,
  summarizeChangedFileScopes,
} from '@/features/chat/utils/changed-files-presentation'
import { canOpenCheckpointDiff } from '@/features/chat/utils/checkpoint-diff-query'
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
import { ChatDiffStatLabel } from './chat-diff-stat-label'

const ACTION_BUTTON_CLASS =
  'border-border bg-background hover:bg-muted hover:text-foreground h-6 border px-2 text-xs font-medium transition-colors'

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
  if (files.length === 0) return null

  const summaryStat = summarizeChatTurnDiffStats(files)
  const expanded = expansion?.cardExpanded ?? shouldAutoExpandChangedFiles(files)
  const allDirectoriesExpanded = expansion?.directoriesExpanded ?? true
  const diffAvailable = canOpenCheckpointDiff(summary)

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
      className='border-border/80 bg-card/45 mt-2 rounded-lg border p-2.5'
      data-changed-files-state={expanded ? 'expanded' : 'preview'}
    >
      <div className='flex items-center justify-between gap-2'>
        <button
          aria-expanded={expanded}
          className='hover:bg-background/60 flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-1 pr-1 text-left'
          data-scroll-anchor-ignore
          type='button'
          onClick={() => setCardExpanded(expansionKey, !expanded)}
        >
          <CaretRightIcon
            aria-hidden='true'
            className={cn(
              'text-muted-foreground/70 size-3.5 shrink-0 transition-transform',
              expanded && 'rotate-90',
            )}
          />
          <span className='text-muted-foreground/65 truncate text-[10px] tracking-[0.12em] uppercase'>
            <span className='tabular-nums'>{files.length}</span>
            {files.length === 1 ? ' changed file' : ' changed files'}
          </span>
          {hasNonZeroChatTurnDiffStat(summaryStat) ? (
            <span className='shrink-0 font-mono text-[10px]'>
              <ChatDiffStatLabel
                additions={summaryStat.additions}
                deletions={summaryStat.deletions}
              />
            </span>
          ) : null}
        </button>
        <div className='flex shrink-0 items-center gap-1.5'>
          {diffAvailable ? (
            <button
              className={ACTION_BUTTON_CLASS}
              data-scroll-anchor-ignore
              type='button'
              onClick={() => void handleOpenCheckpointDiff()}
            >
              View diff
            </button>
          ) : (
            <span className='text-muted-foreground/55 text-[10px]'>
              {checkpointStatusLabel(summary.status)}
            </span>
          )}
          {diffAvailable ? (
            <button
              className={ACTION_BUTTON_CLASS}
              data-scroll-anchor-ignore
              type='button'
              onClick={() => void handleOpenSessionDiff()}
            >
              Session diff
            </button>
          ) : null}
          {expanded ? (
            <button
              className={ACTION_BUTTON_CLASS}
              data-scroll-anchor-ignore
              type='button'
              onClick={() => setDirectoriesExpanded(expansionKey, !allDirectoriesExpanded)}
            >
              {allDirectoriesExpanded ? 'Collapse all' : 'Expand all'}
            </button>
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
          <p className='text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-[11px]'>
            {summarizeChangedFileScopes(files).map((scope, index) => (
              <span className='inline-flex items-center gap-1' key={scope.label}>
                {index > 0 ? <span aria-hidden='true'>·</span> : null}
                <span className='text-foreground/75 font-mono'>{scope.label}</span>
                <span className='tabular-nums'>{scope.fileCount}</span>
                <span>{scope.fileCount === 1 ? 'file' : 'files'}</span>
              </span>
            ))}
          </p>
          <div className='mt-1.5 flex flex-wrap items-center gap-1.5'>
            {selectChangedFilePreview(files).map((file) => (
              <button
                className='border-border/70 bg-background/45 text-muted-foreground hover:bg-muted hover:text-foreground inline-flex max-w-48 items-center rounded-md border px-1.5 py-1 font-mono text-[10px] transition-colors disabled:cursor-default disabled:opacity-70'
                data-scroll-anchor-ignore
                disabled={!diffAvailable}
                key={file.path}
                title={file.path}
                type='button'
                onClick={() => void handleOpenCheckpointDiff(file.path)}
              >
                <span className='truncate'>{changedFileName(file.path)}</span>
              </button>
            ))}
            <button
              className='text-muted-foreground hover:bg-muted hover:text-foreground rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors'
              data-scroll-anchor-ignore
              type='button'
              onClick={() => setCardExpanded(expansionKey, true)}
            >
              Show all <span className='tabular-nums'>{files.length}</span> files
            </button>
          </div>
        </div>
      )}
      {diffError ? <p className='text-destructive mt-1.5 text-[11px]'>{diffError}</p> : null}
    </section>
  )
}

function checkpointStatusLabel(status: ChatTurnDiffSummary['status']) {
  if (status === 'missing') return 'Checkpoint missing'
  if (status === 'error') return 'Checkpoint error'

  return 'Diff unavailable'
}
