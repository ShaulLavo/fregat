import { ChatCircleIcon, FunnelIcon, PlusIcon } from '@phosphor-icons/react'

import { actionItem, section, type Menu } from '@/keymap/menus/utils/model'
import {
  sessionActionsMenu,
  type SessionActionsMenuContext,
} from '@/keymap/menus/utils/session-actions-menu'

/** The rail row's menu: the shared session actions plus opening, drafting and filtering. */
export type SessionMenuContext = SessionActionsMenuContext & {
  /** True when the rail already shows only this runtime's project. */
  readonly scopedToProject: boolean
  readonly newSession: () => void
  readonly open: () => void
  readonly scopeToProject: () => void
}

export function sessionMenu(context: SessionMenuContext): Menu {
  return sessionActionsMenu(context, {
    open: section('open', [
      actionItem({ icon: ChatCircleIcon, id: 'open', label: 'Open', run: context.open }),
      actionItem({
        icon: PlusIcon,
        id: 'newSession',
        label: 'New Session in This Project',
        run: context.newSession,
      }),
    ]),
    // Dropped once the list is already narrowed to this project: filtering to what
    // you are already looking at is not a disabled action, it is a meaningless one.
    project: section('project', [
      !context.scopedToProject &&
        actionItem({
          icon: FunnelIcon,
          id: 'scopeToProject',
          label: 'Show Only This Project',
          run: context.scopeToProject,
        }),
    ]),
  })
}
