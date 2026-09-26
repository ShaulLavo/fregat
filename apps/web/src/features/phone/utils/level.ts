import type { PhoneScreen } from '@workspace/client-core/address/grammar'

import type { ChatSelection } from '@/lib/chat-selection'

/** The phone's stack, root first: sessions, then a session, then what it pushes. */
export type PhoneLevel = 'sessions' | 'session' | PhoneScreen

/** A pushed screen shows over a session or over the list: quick open and settings need none. */
export function phoneLevel(
  selection: ChatSelection['kind'],
  screen: PhoneScreen | null,
): PhoneLevel {
  if (screen) return screen
  return selection === 'auto' ? 'sessions' : 'session'
}

/** Where Back lands when the browser history has nothing of ours to pop. */
export function parentLevel(
  level: PhoneLevel,
  selection: ChatSelection['kind'],
): PhoneLevel | null {
  if (level === 'sessions') return null
  if (level === 'session' || selection === 'auto') return 'sessions'
  return 'session'
}
