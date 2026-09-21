import { use, type ComponentProps } from 'react'

import type { SettingsPage } from '@/features/settings/components/page'
import { loadSettingsPage, loadedSettingsPage } from '@/features/settings/state/load-page'

export function LoadedSettingsPage(props: ComponentProps<typeof SettingsPage>) {
  const { SettingsPage: Page } = loadedSettingsPage() ?? use(loadSettingsPage())
  return <Page {...props} />
}
