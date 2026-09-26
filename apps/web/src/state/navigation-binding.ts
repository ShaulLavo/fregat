import type { Navigation } from '@/state/navigation'
import { createClientInvariantError } from '@/lib/structured-errors'

let current: Navigation | null = null

export function bindNavigation(navigation: Navigation) {
  current = navigation
  return () => {
    if (current === navigation) current = null
  }
}

/** For callers with a fallback when the app shell has not mounted yet. */
export function findNavigation() {
  return current
}

export function getNavigation() {
  if (!current) throw createClientInvariantError('Navigation is not attached to the application.')
  return current
}
