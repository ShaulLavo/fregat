import {
  ArchiveIcon,
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
  /** Archived sessions offer Unarchive in place of Archive, never both. */
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
    section('edit', [
      actionItem({
        icon: PencilSimpleIcon,
        id: 'rename',
        label: 'Rename',
        run: context.rename,
      }),
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
