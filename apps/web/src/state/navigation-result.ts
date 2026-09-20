import type { NavigationResult } from '@/state/navigation-coordinator'
export function supersededNavigation(): Promise<NavigationResult> {
  return Promise.resolve({ status: 'superseded' })
}
