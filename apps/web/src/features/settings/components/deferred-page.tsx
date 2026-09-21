import { Suspense, type ComponentProps } from 'react'

import { LoadedSettingsPage } from '@/features/settings/components/loaded-page'
import { PageLoading } from '@/features/settings/components/page-loading'

/** The settings page behind its loading boundary, shared by the dialog and the settings tab. */
export function DeferredSettingsPage(props: ComponentProps<typeof LoadedSettingsPage>) {
  return (
    <Suspense fallback={<PageLoading showJson={false} />}>
      <LoadedSettingsPage {...props} />
    </Suspense>
  )
}
