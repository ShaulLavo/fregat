import type { QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { SettingsDisplayContext } from '@/features/settings/providers/display-context'
import { SettingsOwnerProvider } from '@/features/settings/providers/owner-provider'
import type { SettingsScope } from '@/features/settings/state/scope-store'
import type { SettingsView } from '@/features/settings/state/view-store'

export function SettingsDisplayProvider({
  children,
  queryClient,
  scope,
  view,
}: {
  children: ReactNode
  queryClient: QueryClient
  scope: SettingsScope
  view: SettingsView
}) {
  return (
    <SettingsDisplayContext value={{ scope, view }}>
      <SettingsOwnerProvider queryClient={queryClient}>{children}</SettingsOwnerProvider>
    </SettingsDisplayContext>
  )
}
