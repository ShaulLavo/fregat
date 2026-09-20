import {
  CopyIcon,
  ArrowsClockwiseIcon,
  ArchiveIcon,
  CheckIcon,
  ClockIcon,
  PushPinIcon,
  EnvelopeSimpleIcon,
  AlarmIcon,
  ArrowUUpLeftIcon,
  ChatCircleIcon,
  FunnelIcon,
  PencilSimpleIcon,
  PlusIcon,
  StopCircleIcon,
  TrashIcon,
} from '@phosphor-icons/react'

import type { SessionRuntimeState, SessionRuntimeStatus } from '@workspace/contracts'

import { actionItem, section, type Menu } from '@/keymap/menus/utils/model'

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

export type SessionMenuContext = {
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
  readonly archived: boolean
  readonly canStopAgent: boolean
  /** True when the rail already shows only this runtime's project. */
  readonly scopedToProject: boolean
  readonly archive: () => void
  readonly deleteSession: () => void
  readonly newSession: () => void
  readonly open: () => void
  readonly rename: () => void
  readonly scopeToProject: () => void
  readonly stopAgent: () => void
  readonly unarchive: () => void
}

export function sessionMenu(context: SessionMenuContext): Menu {
  return [
    section('open', [
      actionItem({
        icon: ChatCircleIcon,
        id: 'open',
        label: 'Open',
        run: context.open,
      }),
      actionItem({
        icon: PlusIcon,
        id: 'newSession',
        label: 'New Session in This Project',
        run: context.newSession,
      }),
    ]),
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
    // Dropped once the list is already narrowed to this project: filtering to what
    // you are already looking at is not a disabled action, it is a meaningless one.
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
    section('project', [
      !context.scopedToProject &&
        actionItem({
          icon: FunnelIcon,
          id: 'scopeToProject',
          label: 'Show Only This Project',
          run: context.scopeToProject,
        }),
    ]),
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
