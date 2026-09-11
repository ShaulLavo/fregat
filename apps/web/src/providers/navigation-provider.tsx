import { useEffect, type ReactNode } from 'react'
import { RouterProvider } from '@tanstack/react-router'
import { NavigationContext } from '@/providers/navigation-context'
import { bindNavigation } from '@/state/navigation-binding'
import type { Navigation } from '@/state/navigation'

export function NavigationProvider({
  navigation,
  children,
}: {
  readonly navigation: Navigation
  readonly children: ReactNode
}) {
  useEffect(() => {
    const unbind = bindNavigation(navigation)
    const flush = () => navigation.router.history.flush()
    window.addEventListener('pagehide', flush)
    return () => {
      unbind()
      flush()
      window.removeEventListener('pagehide', flush)
    }
  }, [navigation])
  return (
    <NavigationContext value={navigation}>
      <RouterProvider router={navigation.router} />
      {children}
    </NavigationContext>
  )
}
