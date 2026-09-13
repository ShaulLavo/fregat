import { PencilSimpleIcon, XIcon } from '@phosphor-icons/react'

import { actionItem, section, type Menu } from '@/keymap/menus/utils/model'

export type TerminalTabMenuContext = {
  readonly kill: () => void
  readonly rename: () => void
}

export function terminalTabMenu(context: TerminalTabMenuContext): Menu {
  return [
    section('edit', [
      actionItem({ icon: PencilSimpleIcon, id: 'rename', label: 'Rename…', run: context.rename }),
    ]),
    section('close', [
      actionItem({ icon: XIcon, id: 'kill', label: 'Kill Terminal', run: context.kill }),
    ]),
  ]
}
