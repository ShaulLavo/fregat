import { queryOptions } from '@tanstack/react-query'
import type { ComponentType } from 'react'

import type { useSessionDiffScope } from '@/features/chat/hooks/use-session-diff-scope'
import type { PhoneLevel } from '@/features/phone/utils/level'
import { phoneQueryKeys } from '@/features/phone/utils/query-keys'

export type ScreenProps = {
  readonly diffScope: ReturnType<typeof useSessionDiffScope>
  readonly rootPath: string
}

type ScreenView = ComponentType<ScreenProps>

/** Every screen is its own chunk: the phone downloads the editor only when a file opens. */
export function screenQueryOptions(level: PhoneLevel) {
  return queryOptions({
    queryKey: phoneQueryKeys.screenModule(level),
    queryFn: loaders[level],
    staleTime: 'static',
    structuralSharing: false,
    gcTime: Infinity,
    // The browser may already have the chunk while offline.
    networkMode: 'always',
  })
}

// A loader per level gives every import its own Vite preload call site.
const loaders: Record<PhoneLevel, () => Promise<ScreenView>> = {
  sessions: () =>
    import('@/features/phone/components/sessions-screen').then((m) => m.SessionsScreen),
  session: () => import('@/features/phone/components/session-screen').then((m) => m.SessionScreen),
  changes: () => import('@/features/phone/components/changes-screen').then((m) => m.ChangesScreen),
  file: () => import('@/features/phone/components/file-screen').then((m) => m.FileScreen),
  terminal: () =>
    import('@/features/phone/components/terminal-screen').then((m) => m.TerminalScreen),
}
