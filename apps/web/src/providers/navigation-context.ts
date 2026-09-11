import { createContext } from 'react'
import type { Navigation } from '@/state/navigation'

export const NavigationContext = createContext<Navigation | null>(null)
