import type { SettingsSession } from '@/connection/state/session'
import type { Theme } from '@/theme/utils/theme'

export type WorkbenchPaneProps = {
  session: SettingsSession
  rootPath: string
  theme: Theme
  enabled: boolean
  onOpenFile: (path: string, line?: number) => void
}
