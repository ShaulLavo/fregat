import { useContext } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { SettingsOwnerContext } from '@/lib/settings-owner/providers/owner-context'

export function useSettingsOwner() {
  const owner = useContext(SettingsOwnerContext)
  return useQueryClient(owner ?? undefined)
}
