import { cn } from '@workspace/ui/lib/utils'
import { Button } from '@workspace/ui/components/button'
import {
  BrainIcon,
  CaretDownIcon,
  CheckCircleIcon,
  CheckIcon,
  FileTextIcon,
  InfoIcon,
  ListChecksIcon,
  ShieldCheckIcon,
  TerminalWindowIcon,
  UserCircleIcon,
  WarningCircleIcon,
  XIcon,
} from '@phosphor-icons/react'

import type {
  ChatActivityIconKey,
  ChatActivityOutcome,
  ChatActivityPlanStep,
} from '@/features/chat/utils/activity-presentation'
import type {
  ChatWorkLogEntry,
  ChatWorkLogPlan,
  ChatWorkLogTone,
} from '@/features/chat/utils/work-log'
import { useChatWorkLogExpansionStore } from '../state/chat-work-log-expansion-store'

export function ActivityRow({ activity }: { activity: ChatWorkLogEntry }) {
  const expanded = useChatWorkLogExpansionStore(
    (state) => state.expandedRowIds[activity.id] ?? false,
  )
  const toggleRowExpanded = useChatWorkLogExpansionStore((state) => state.toggleRowExpanded)
  const Icon = activityIcon(activity.icon)
  const detail = activityRowDetail(activity)
  const failed = isFailedActivity(activity)
  const expandable = isExpandableActivity(activity)
  const summary = (
    <>
      <span
        className={cn(
          'flex size-5 shrink-0 items-center justify-center text-muted-foreground/65',
          activityIconToneClass(activity.tone, failed),
        )}
      >
        {/* eslint-disable-next-line oxc-react-compiler/static-components -- Icon is a stable Phosphor component chosen by activityIcon, not created during render. */}
        <Icon className='size-3' />
      </span>
      <p
        className={cn(
          'min-w-0 flex-1 truncate text-[11px] leading-5',
          activityTextToneClass(activity.tone, failed),
        )}
        title={detail ? `${activity.title} - ${detail}` : activity.title}
      >
        <span className={failed ? 'text-destructive' : 'text-foreground/80'}>{activity.title}</span>
        {detail ? <span className='text-muted-foreground/55 tabular-nums'> - {detail}</span> : null}
      </p>
      {activityOutcomeGlyph(activity.outcome, failed)}
      {expandable ? (
        <CaretDownIcon
          className={cn(
            'text-muted-foreground/50 size-3 shrink-0 transition-transform',
            expanded && 'rotate-180',
          )}
        />
      ) : null}
    </>
  )

  return (
    <div className='rounded-md'>
      {expandable ? (
        <Button
          aria-expanded={expanded}
          className='h-auto w-full min-w-0 justify-start gap-2 px-1 py-1 text-left font-normal'
          variant='ghost'
          type='button'
          onClick={() => toggleRowExpanded(activity.id)}
        >
          {summary}
        </Button>
      ) : (
        <div className='flex min-w-0 items-center gap-2 px-1 py-1'>{summary}</div>
      )}
      {expanded && expandable ? activityRowBody(activity) : null}
      {activity.plan ? activityRowPlan(activity.plan) : null}
    </div>
  )
}

function activityRowBody(activity: ChatWorkLogEntry) {
  return (
    <div className='border-border/45 mt-1 ml-4 space-y-2 border-l pt-0.5 pl-3'>
      {activityRowBodySection('Details', activity.detail)}
      {activityRowBodySection('Input', activity.input)}
      {activityRowBodySection('Command', activity.command)}
      {activityRowBodySection('Output', activity.output)}
      {activity.changedFiles.length > 0
        ? activityRowBodySection('Changed files', activity.changedFiles.join('\n'))
        : null}
    </div>
  )
}

function activityRowBodySection(label: string, value: string | null) {
  if (!value) return null

  return (
    <div>
      <p className='text-muted-foreground/50 text-[9px] tracking-[0.16em] uppercase'>{label}</p>
      <pre
        aria-label={label}
        className='text-muted-foreground/80 max-h-64 overflow-auto font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap'
      >
        {value}
      </pre>
    </div>
  )
}

function activityRowPlan(plan: ChatWorkLogPlan) {
  return (
    <div className='border-border/45 mt-1 ml-4 border-l pt-0.5 pl-3'>
      <p
        aria-label='Plan progress'
        className='text-muted-foreground/50 text-[9px] tracking-[0.16em] uppercase tabular-nums'
      >
        Plan {plan.completedCount}/{plan.steps.length}
      </p>
      <ol className='mt-0.5 space-y-0.5'>
        {plan.steps.map((step) => (
          <li className='flex items-start gap-1.5 text-[11px] leading-5' key={step.step}>
            <span
              className={cn(
                'mt-[7px] size-1.5 shrink-0 rounded-full',
                planStepDotClass(step.status),
              )}
            />
            <span className={planStepTextClass(step.status)}>{step.step}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function activityOutcomeGlyph(outcome: ChatActivityOutcome | null, failed: boolean) {
  if (failed) {
    return (
      <span aria-label='Failed' className='flex size-4 shrink-0 items-center justify-center'>
        <XIcon className='text-destructive size-3' />
      </span>
    )
  }
  if (outcome !== 'succeeded') return null

  return (
    <span aria-label='Succeeded' className='flex size-4 shrink-0 items-center justify-center'>
      <CheckIcon className='text-success size-3' />
    </span>
  )
}

function planStepDotClass(status: ChatActivityPlanStep['status']) {
  if (status === 'completed') return 'bg-success'
  if (status === 'inProgress') return 'bg-info'

  return 'bg-muted-foreground/40'
}

function planStepTextClass(status: ChatActivityPlanStep['status']) {
  if (status === 'completed') return 'text-muted-foreground/50 line-through'
  if (status === 'inProgress') return 'text-foreground/85'

  return 'text-muted-foreground/70'
}

function isFailedActivity(activity: ChatWorkLogEntry) {
  return activity.outcome === 'failed' || activity.tone === 'error'
}

function isExpandableActivity(activity: ChatWorkLogEntry) {
  return Boolean(
    activity.detail ||
    activity.input ||
    activity.command ||
    activity.output ||
    activity.changedFiles.length > 0,
  )
}

function activityIcon(icon: ChatActivityIconKey) {
  if (icon === 'approval') return ShieldCheckIcon
  if (icon === 'context') return FileTextIcon
  if (icon === 'error') return WarningCircleIcon
  if (icon === 'task') return ListChecksIcon
  if (icon === 'thinking') return BrainIcon
  if (icon === 'tool') return TerminalWindowIcon
  if (icon === 'user-input') return UserCircleIcon
  if (icon === 'info') return InfoIcon

  return CheckCircleIcon
}

function activityRowDetail(activity: ChatWorkLogEntry) {
  if (activity.detail) return activity.detail
  if (activity.command) return activity.command
  if (activity.changedFiles.length > 0) return changedFilesDetail(activity.changedFiles)
  if (!activity.status) return null
  if (activity.status === 'Completed') return null

  return activity.status
}

function changedFilesDetail(changedFiles: readonly string[]) {
  const [firstPath] = changedFiles
  if (!firstPath) return null
  if (changedFiles.length === 1) return firstPath

  return `${firstPath} +${changedFiles.length - 1} more`
}

function activityIconToneClass(tone: ChatWorkLogTone, failed: boolean) {
  if (failed) return 'text-destructive'
  if (tone === 'thinking') return 'text-muted-foreground/70'
  if (tone === 'tool') return 'text-info'

  return 'text-muted-foreground/65'
}

function activityTextToneClass(tone: ChatWorkLogTone, failed: boolean) {
  if (failed) return 'text-destructive'
  if (tone === 'thinking') return 'text-muted-foreground/55'

  return 'text-muted-foreground/75'
}
