import {
  ArchiveIcon,
  CaretDownIcon,
  CaretRightIcon,
  CopyIcon,
  FunnelIcon,
  PencilSimpleIcon,
  PlusIcon,
  GitForkIcon,
  TrashIcon,
} from '@phosphor-icons/react'

import { actionItem, section, type Menu } from '@/keymap/menus/utils/model'

export type ProjectMenuContext = {
  readonly ownerLabel?: string
  /** False once every session is already filed away — archiving nothing is not an action. */
  readonly canArchiveSessions: boolean
  /** What the header is showing right now, so the item offers the flip, not a state. */
  readonly collapsed: boolean
  /** True when the rail already shows only this project. */
  readonly scopedToProject: boolean
  readonly archiveAllSessions: () => void
  readonly copyPath: () => void
  readonly deleteProject: () => void
  readonly newSession: () => void
  readonly manageWorktrees: () => void
  readonly renameProject: () => void
  readonly scopeToProject: () => void
  readonly toggleCollapsed: () => void
}

export function projectMenu(context: ProjectMenuContext): Menu {
  return [
    section('sessions', [
      actionItem({
        icon: PlusIcon,
        id: 'newSession',
        label: context.ownerLabel
          ? `New Session in This Project (${context.ownerLabel})`
          : 'New Session in This Project',
        run: context.newSession,
      }),
    ]),
    section('manage', [
      actionItem({
        icon: GitForkIcon,
        id: 'manageWorktrees',
        label: context.ownerLabel ? `Manage Worktrees (${context.ownerLabel})` : 'Manage Worktrees',
        run: context.manageWorktrees,
      }),
      actionItem({
        icon: PencilSimpleIcon,
        id: 'renameProject',
        label: context.ownerLabel ? `Rename Project (${context.ownerLabel})` : 'Rename Project',
        run: context.renameProject,
      }),
      context.canArchiveSessions &&
        actionItem({
          icon: ArchiveIcon,
          id: 'archiveAllSessions',
          label: 'Archive All Sessions',
          run: context.archiveAllSessions,
        }),
      actionItem({
        destructive: true,
        icon: TrashIcon,
        id: 'deleteProject',
        label: 'Delete Project',
        run: context.deleteProject,
      }),
    ]),
    section('view', [
      // Dropped once the list is already narrowed to this project — same rule as the
      // session menu: filtering to what you are looking at is a meaningless action.
      !context.scopedToProject &&
        actionItem({
          icon: FunnelIcon,
          id: 'scopeToProject',
          label: 'Show Only This Project',
          run: context.scopeToProject,
        }),
      actionItem({
        icon: context.collapsed ? CaretDownIcon : CaretRightIcon,
        id: 'toggleCollapsed',
        label: context.collapsed ? 'Expand Project' : 'Collapse Project',
        run: context.toggleCollapsed,
      }),
    ]),
    section('copy', [
      actionItem({
        icon: CopyIcon,
        id: 'copyPath',
        label: context.ownerLabel ? `Copy Path (${context.ownerLabel})` : 'Copy Path',
        run: context.copyPath,
      }),
    ]),
  ]
}
