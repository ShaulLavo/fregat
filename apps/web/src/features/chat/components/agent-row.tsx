import { CaretRightIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'
import { cn } from '@workspace/ui/lib/utils'

import { ActivityRow } from '@/features/chat/components/activity-row'
import { WorkingTimer } from '@/features/chat/components/working-timer'
import { useChatWorkLogExpansionStore } from '@/features/chat/state/chat-work-log-expansion-store'
import {
  chatAgentElapsed,
  chatAgentIsWorking,
  chatAgentName,
  chatAgentStatus,
  chatAgentToolCount,
  type ChatAgentEntry,
} from '@/features/chat/utils/agents'

export function AgentRow({ entry, groupId }: { entry: ChatAgentEntry; groupId: string }) {
  const id = `${groupId}:${entry.agent.threadId}`
  const expanded = useChatWorkLogExpansionStore((state) => state.expandedGroupIds[id] ?? false)
  const toggle = useChatWorkLogExpansionStore((state) => state.toggleGroupExpanded)
  const working = chatAgentIsWorking(entry.agent)
  const lastTool = entry.activities.at(-1)
  const toolCount = chatAgentToolCount(entry)
  const summary = entry.summary ?? lastTool?.title ?? entry.description ?? 'Agent started'
  const rowTitle = [chatAgentName(entry.agent), entry.agent.model, summary]
    .filter(Boolean)
    .join(' · ')

  return (
    <section className='min-w-0 py-2' data-agent-thread-id={entry.agent.threadId}>
      <Button
        aria-expanded={expanded}
        className='h-auto w-full items-start justify-start gap-2 px-2 py-1.5 text-left font-normal'
        title={rowTitle}
        variant='ghost'
        onClick={() => toggle(id)}
      >
        <CaretRightIcon
          aria-hidden='true'
          className={cn(
            'mt-0.5 size-(--icon-size-sm) shrink-0 transition-transform',
            expanded && 'rotate-90',
          )}
        />
        <span className='flex min-w-0 flex-1 flex-col gap-1'>
          <span className='flex min-w-0 items-center gap-2 text-xs'>
            <span className='truncate font-medium'>{chatAgentName(entry.agent)}</span>
            <span
              className={cn(
                'text-muted-foreground ml-auto shrink-0',
                entry.agent.status === 'failed' && 'text-destructive',
              )}
            >
              {chatAgentStatus(entry.agent)}
            </span>
            {working ? <Spinner size='xs' aria-hidden='true' /> : null}
          </span>
          <span className='text-muted-foreground truncate text-xs'>{summary}</span>
          <span className='text-muted-foreground text-2xs flex items-center gap-2 tabular-nums'>
            {entry.agent.model ? <span className='truncate'>{entry.agent.model}</span> : null}
            {working ? (
              <WorkingTimer startedAt={entry.startedAt} />
            ) : (
              <span>{chatAgentElapsed(entry) ?? '0s'}</span>
            )}
            <span>
              {toolCount} {toolCount === 1 ? 'tool call' : 'tool calls'}
            </span>
            {entry.totalTokens !== null ? (
              <span>{entry.totalTokens.toLocaleString()} tokens</span>
            ) : null}
          </span>
        </span>
      </Button>
      {expanded ? (
        <div className='ml-3 min-w-0 space-y-2 py-2 pl-3'>
          {entry.description ? (
            <p className='text-muted-foreground text-xs whitespace-pre-wrap'>{entry.description}</p>
          ) : null}
          {entry.agent.path ? (
            <p
              className='text-muted-foreground text-2xs font-meta truncate'
              title={entry.agent.path}
            >
              {entry.agent.path}
            </p>
          ) : null}
          {entry.activities.map((activity) => (
            <ActivityRow activity={activity} key={activity.id} />
          ))}
        </div>
      ) : null}
    </section>
  )
}
