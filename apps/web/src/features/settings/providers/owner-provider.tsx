import type { ReactNode } from 'react'
import type { QueryClient } from '@tanstack/react-query'

import { SettingsOwnerContext } from '@/lib/settings-owner/providers/owner-context'

export function SettingsOwnerProvider({
  children,
  queryClient,
}: {
  readonly children: ReactNode
  readonly queryClient: QueryClient
}) {
  return <SettingsOwnerContext value={queryClient}>{children}</SettingsOwnerContext>
}
