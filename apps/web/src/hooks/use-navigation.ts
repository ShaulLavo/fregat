import { use } from 'react'
import { NavigationContext } from '@/providers/navigation-context'
import { createClientInvariantError } from '@/lib/structured-errors'

export function useNavigation() {
  const navigation = use(NavigationContext)
  if (!navigation) throw createClientInvariantError('NavigationProvider is missing.')
  return navigation
}
