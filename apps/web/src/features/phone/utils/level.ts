import type { PhoneScreen } from '@workspace/client-core/address/grammar'

import type { ChatSelection } from '@/lib/chat-selection'

/** The phone's stack, root first: sessions, then a session, then what it pushes. */
export type PhoneLevel = 'sessions' | 'session' | PhoneScreen

export function phoneLevel(
  selection: ChatSelection['kind'],
  screen: PhoneScreen | null,
): PhoneLevel {
  if (selection === 'auto') return 'sessions'
  return screen ?? 'session'
}

/** Where Back lands when the browser history has nothing of ours to pop. */
export function parentLevel(level: PhoneLevel): PhoneLevel | null {
  if (level === 'sessions') return null
  if (level === 'session') return 'sessions'
  return 'session'
}
