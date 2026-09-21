import { use, type ComponentProps } from 'react'

import type { TerminalPanel } from '@/features/terminal/components/panel'
import { loadTerminalPanel, loadedTerminalPanel } from '@/features/terminal/state/load-panel'

export function LoadedTerminalPanel(props: ComponentProps<typeof TerminalPanel>) {
  const { TerminalPanel: Panel } = loadedTerminalPanel() ?? use(loadTerminalPanel())
  return <Panel {...props} />
}
