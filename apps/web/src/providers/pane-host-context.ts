import { createContext } from 'react'

import type { ChatModeToolTab } from '@/features/chat-mode/utils/panels'
import type { WorkbenchBottomTab, WorkbenchSidebarTab } from '@/features/workbench/utils/panels'

/** One view a host can show, with its actions already bound to that host. */
export type PaneHostView<Tab extends string = string> = {
  readonly label: string
  readonly value: Tab
  /** Shows this view, revealing the pane if it was hidden. */
  readonly select: () => void
  /** The rail gesture: the showing view hides the pane, any other view is selected. */
  readonly toggle: () => void
}

type PaneHostOf<Kind extends string, Tab extends string> = {
  readonly kind: Kind
  readonly views: readonly PaneHostView<Tab>[]
  /** The last selected view; kept while the pane is hidden so a reopen lands on it. */
  readonly activeView: Tab
  readonly visible: boolean
  readonly hide: () => void
}

/**
 * The container a pane header or rail sits in. Each host's views come from its
 * own tab list, so a bottom-panel tab cannot appear in the sidebar by type.
 */
export type PaneHost =
  | PaneHostOf<'workbench-sidebar', WorkbenchSidebarTab>
  | PaneHostOf<'workbench-bottom', WorkbenchBottomTab>
  | PaneHostOf<'chat-tools', ChatModeToolTab>

export type PaneHostKind = PaneHost['kind']

export const PaneHostContext = createContext<PaneHost | null>(null)
