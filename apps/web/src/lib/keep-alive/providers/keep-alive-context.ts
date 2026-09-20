import { createContext } from 'react'

import type { KeepAliveStore } from '@/lib/keep-alive/state/store'

export const KeepAliveContext = createContext<KeepAliveStore | null>(null)
