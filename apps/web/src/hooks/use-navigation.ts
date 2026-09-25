import { use } from 'react'
import { NavigationContext } from '@/providers/navigation-context'
import { clientErrors } from '@/lib/structured-errors'

export function useNavigation() {
  const navigation = use(NavigationContext)
  if (!navigation) throw clientErrors.CONTEXT_MISSING({ message: 'NavigationProvider is missing.' })
  return navigation
}
