import { use } from 'react'
import { NavigationContext } from '@/providers/navigation-context'
import { requireContext } from '@/lib/require-context'

export function useNavigation() {
  const navigation = use(NavigationContext)
  requireContext(navigation, 'NavigationProvider is missing.')
  return navigation
}
