import { EyeSlashIcon } from '@phosphor-icons/react'

import { CHAT_MODE_TOOL_TABS, chatModeToolTabLabel } from '@/features/chat-mode/utils/panels'
import {
  actionItem,
  section,
  type Menu,
  type MenuRadioGroupItem,
  type MenuRadioItem,
} from '@/keymap/menus/utils/model'
import type { WorkbenchSidebarTab } from '@/features/workbench/utils/panels'

/**
 * Which container the header is sitting in. The two hosts differ in what they
 * can offer: the chat tool pane has real open/closed state, while the workbench
 * sidebar is always on screen and can only swap the view inside it.
 */
type PaneHeaderHost = 'chat-pane' | 'workbench-sidebar'

export type PaneHeaderMenuContext = {
  /** The view this pane currently shows. Matches one of the radio option values. */
  readonly activeView: string
  readonly host: PaneHeaderHost
  /** Null where the host has no visibility state, so there is nothing to hide. */
  readonly hidePane: (() => void) | null
  readonly selectView: (value: string) => void
  readonly title: string
}

type WorkbenchSidebarView = MenuRadioItem & { readonly value: WorkbenchSidebarTab }

/** Rail order, so the menu reads in the same sequence as the buttons beside it. */
const WORKBENCH_SIDEBAR_VIEWS: readonly WorkbenchSidebarView[] = [
  { label: 'Files', value: 'files' },
  { label: 'Git', value: 'git' },
  { label: 'Search', value: 'search' },
  { label: 'Logs', value: 'logs' },
  { label: 'Chat', value: 'chat' },
]

export function paneHeaderMenu(context: PaneHeaderMenuContext): Menu {
  return [
    section('view', [viewRadioGroup(context)]),
    // Dropped entirely in the workbench sidebar: that host has no visibility
    // state, so a Hide item there could only ever be a disabled promise.
    section('pane', [
      context.hidePane &&
        actionItem({
          icon: EyeSlashIcon,
          id: 'hide',
          label: `Hide ${context.title}`,
          run: context.hidePane,
        }),
    ]),
  ]
}

function paneHeaderViews(host: PaneHeaderHost): readonly MenuRadioItem[] {
  if (host === 'workbench-sidebar') return WORKBENCH_SIDEBAR_VIEWS

  return CHAT_MODE_TOOL_TABS.map((tab) => ({ label: chatModeToolTabLabel(tab), value: tab }))
}

/** Narrows the radio group's string payload back to a tab the sidebar accepts. */
export function isWorkbenchSidebarView(value: string): value is WorkbenchSidebarTab {
  return WORKBENCH_SIDEBAR_VIEWS.some((view) => view.value === value)
}

function viewRadioGroup(context: PaneHeaderMenuContext): MenuRadioGroupItem {
  return {
    id: 'view',
    kind: 'radio-group',
    options: paneHeaderViews(context.host),
    select: context.selectView,
    value: context.activeView,
  }
}
