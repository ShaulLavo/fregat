import { useState } from 'react'

import { useNavigation } from '@/hooks/use-navigation'
import type { ChatSelection } from '@/lib/chat-selection'
import { parentLevel, type PhoneLevel } from '@/features/phone/utils/level'

/**
 * Back pops the browser history while it holds screens this shell pushed; from a deep link it
 * replaces the entry with the parent screen, so Back never leaves the app.
 */
export function useBackAction(level: PhoneLevel, selection: ChatSelection['kind']) {
  const navigation = useNavigation()
  const [firstIndex] = useState(navigation.historyIndex)
  const parent = parentLevel(level, selection)

  if (parent === null) return null
  return () => {
    if (navigation.historyIndex() > firstIndex) return navigation.back()
    if (parent === 'sessions') return void navigation.showPhoneSessions(true)
    return void navigation.showPhoneScreen(null, true)
  }
}
