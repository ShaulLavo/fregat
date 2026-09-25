import {
  BracketsCurlyIcon,
  CopyIcon,
  DownloadSimpleIcon,
  MarkdownLogoIcon,
  ArrowsClockwiseIcon,
  ArchiveIcon,
  CheckIcon,
  ClockIcon,
  PushPinIcon,
  EnvelopeSimpleIcon,
  AlarmIcon,
  ArrowUUpLeftIcon,
  PencilSimpleIcon,
  StopCircleIcon,
  TrashIcon,
} from '@phosphor-icons/react'

import type { SessionRuntimeState, SessionRuntimeStatus } from '@workspace/contracts'

import { actionItem, section, type Menu, type MenuSection } from '@/keymap/menus/utils/model'

/**
 * A provider process is still holding this session in these states, so stopping it
 * frees something real. `stopped` and `error` mean the runtime is already gone —
 * there is nothing left to stop, which is why the item is omitted rather than
 * disabled.
 */
const STOPPABLE_SESSION_STATUSES: readonly SessionRuntimeStatus[] = [
  'idle',
  'starting',
  'running',
  'waiting',
  'ready',
  'interrupted',
]

export function canStopAgentSession(runtime: SessionRuntimeState | null | undefined) {
  if (!runtime) return false

  return STOPPABLE_SESSION_STATUSES.includes(runtime.status)
}

/** The session actions every surface offers: the rail row, the stage header, the sidebar header. */
export type SessionActionsMenuContext = {
  readonly titleGeneration?: {
    readonly supported: boolean
    readonly pending: boolean
    readonly requesting: boolean
    readonly error: string | null
    readonly regenerate: () => void
  }
  readonly lifecycle?: {
    readonly settlement: boolean
    readonly snooze: boolean
    readonly pinning: boolean
    readonly settleBlocked: boolean
    readonly snoozeBlocked: boolean
    readonly settled: boolean
    readonly snoozed: boolean
    readonly pinned: boolean
    readonly pending: boolean
    readonly settle: () => void
    readonly unsettle: () => void
    readonly requestSnooze: () => void
    readonly unsnooze: () => void
    readonly pin: () => void
    readonly unpin: () => void
  }
  /** Archived sessions offer Unarchive in place of Archive, never both. */
  readonly canMarkUnread: boolean
  readonly woke: boolean
  readonly markUnread: () => void
  readonly acknowledgeWake: () => void
  readonly copyPath: () => void
  readonly copyBranch: (() => void) | null
  readonly copySessionId: () => void
  /** A session with no user message has nothing to export. */
  readonly hasMessages: boolean
  readonly copyTranscript: () => void
  readonly exportTranscript: (format: 'markdown' | 'json') => void
  readonly archived: boolean
  readonly canStopAgent: boolean
  readonly archive: () => void
  readonly deleteSession: () => void
  readonly rename: () => void
  readonly stopAgent: () => void
  readonly unarchive: () => void
}

/** Sections only one surface can offer, placed where that surface's menu has always had them. */
export type SessionMenuContributions = {
  readonly open?: MenuSection
  readonly project?: MenuSection
}

export function sessionActionsMenu(
  context: SessionActionsMenuContext,
  contributions: SessionMenuContributions = {},
): Menu {
  return [
    ...(contributions.open ? [contributions.open] : []),
    ...(context.lifecycle && !context.archived
      ? [
          section('lifecycle', [
            context.lifecycle.settlement &&
              actionItem({
                icon: CheckIcon,
                id: 'settle',
                label: context.lifecycle.settled ? 'Move to active' : 'Mark as settled',
                disabled:
                  context.lifecycle.pending ||
                  (!context.lifecycle.settled && context.lifecycle.settleBlocked),
                run: context.lifecycle.settled
                  ? context.lifecycle.unsettle
                  : context.lifecycle.settle,
              }),
            context.lifecycle.snooze &&
              actionItem({
                icon: ClockIcon,
                id: 'snooze',
                label: context.lifecycle.snoozed ? 'Unsnooze' : 'Snooze…',
                disabled:
                  context.lifecycle.pending ||
                  (!context.lifecycle.snoozed && context.lifecycle.snoozeBlocked),
                run: context.lifecycle.snoozed
                  ? context.lifecycle.unsnooze
                  : context.lifecycle.requestSnooze,
              }),
            context.lifecycle.pinning &&
              actionItem({
                icon: PushPinIcon,
                id: 'pin',
                label: context.lifecycle.pinned ? 'Unpin' : 'Pin',
                disabled: context.lifecycle.pending,
                run: context.lifecycle.pinned ? context.lifecycle.unpin : context.lifecycle.pin,
              }),
          ]),
        ]
      : []),
    section('edit', [
      context.canMarkUnread &&
        actionItem({
          icon: EnvelopeSimpleIcon,
          id: 'markUnread',
          label: 'Mark as unread',
          run: context.markUnread,
        }),
      context.woke &&
        actionItem({
          icon: AlarmIcon,
          id: 'acknowledgeWake',
          label: 'Acknowledge wake',
          run: context.acknowledgeWake,
        }),
      actionItem({
        icon: PencilSimpleIcon,
        id: 'rename',
        label: 'Rename',
        run: context.rename,
        takesFocus: true,
      }),
      context.titleGeneration?.supported
        ? actionItem({
            icon: ArrowsClockwiseIcon,
            id: 'regenerateTitle',
            label: titleGenerationLabel(context.titleGeneration),
            disabled: context.titleGeneration.pending || context.titleGeneration.requesting,
            run: context.titleGeneration.regenerate,
          })
        : false,
      !context.archived &&
        actionItem({
          icon: ArchiveIcon,
          id: 'archive',
          label: 'Archive',
          run: context.archive,
        }),
      context.archived &&
        actionItem({
          icon: ArrowUUpLeftIcon,
          id: 'unarchive',
          label: 'Unarchive',
          run: context.unarchive,
        }),
      actionItem({
        destructive: true,
        icon: TrashIcon,
        id: 'delete',
        label: 'Delete',
        run: context.deleteSession,
      }),
    ]),
    section('copy', [
      actionItem({ icon: CopyIcon, id: 'copyPath', label: 'Copy Path', run: context.copyPath }),
      context.copyBranch &&
        actionItem({
          icon: CopyIcon,
          id: 'copyBranch',
          label: 'Copy Branch',
          run: context.copyBranch,
        }),
      actionItem({
        icon: CopyIcon,
        id: 'copySessionId',
        label: 'Copy Session ID',
        run: context.copySessionId,
      }),
    ]),
    section('export', [
      actionItem({
        disabled: !context.hasMessages,
        icon: MarkdownLogoIcon,
        id: 'copyTranscript',
        label: 'Copy as Markdown',
        run: context.copyTranscript,
      }),
      actionItem({
        disabled: !context.hasMessages,
        icon: DownloadSimpleIcon,
        id: 'exportMarkdown',
        label: 'Export as Markdown…',
        run: () => context.exportTranscript('markdown'),
      }),
      actionItem({
        disabled: !context.hasMessages,
        icon: BracketsCurlyIcon,
        id: 'exportJson',
        label: 'Export as JSON…',
        run: () => context.exportTranscript('json'),
      }),
    ]),
    ...(contributions.project ? [contributions.project] : []),
    section('agent', [
      context.canStopAgent &&
        actionItem({
          icon: StopCircleIcon,
          id: 'stopAgent',
          label: 'Stop Agent Session',
          run: context.stopAgent,
        }),
    ]),
  ]
}

function titleGenerationLabel(state: { readonly pending: boolean; readonly error: string | null }) {
  if (state.pending) return 'Regenerating…'
  if (state.error) return 'Retry title generation'
  return 'Regenerate title'
}
