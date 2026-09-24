import { EyeSlashIcon } from '@phosphor-icons/react'

import type { PaneHost, PaneHostView } from '@/providers/pane-host-context'
import { actionItem, section, type Menu, type MenuRadioGroupItem } from '@/keymap/menus/utils/model'

/**
 * A pane header's menu: the host's views as a radio group, then Hide for that
 * host alone. Outside every host there is nothing to switch or hide.
 */
export function paneHeaderMenu(host: PaneHost | null, title: string): Menu {
  if (!host) return []

  return [
    section('view', [viewRadioGroup(host)]),
    section('pane', [
      actionItem({ icon: EyeSlashIcon, id: 'hide', label: `Hide ${title}`, run: host.hide }),
    ]),
  ]
}

function viewRadioGroup(host: PaneHost): MenuRadioGroupItem {
  const views: readonly PaneHostView[] = host.views
  return {
    id: 'view',
    kind: 'radio-group',
    options: views.map(({ label, value }) => ({ label, value })),
    // The radio group hands back a string; only a view this host lists is selected.
    select: (value) => views.find((view) => view.value === value)?.select(),
    value: host.activeView,
  }
}
