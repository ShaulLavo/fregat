import { createContext } from 'react'
import type { QueryClient } from '@tanstack/react-query'

export const SettingsOwnerContext = createContext<QueryClient | null>(null)
