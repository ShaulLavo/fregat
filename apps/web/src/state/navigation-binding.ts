import type { Navigation } from '@/state/navigation'
import { createClientInvariantError } from '@/lib/structured-errors'

let current: Navigation | null = null

export function bindNavigation(navigation: Navigation) {
  current = navigation
  return () => {
    if (current === navigation) current = null
  }
}

export function getNavigation() {
  if (!current) throw createClientInvariantError('Navigation is not attached to the application.')
  return current
}
