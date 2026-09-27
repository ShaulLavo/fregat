import { ChatStage } from '@/features/chat-mode/components/chat-stage'
import { SessionHeader } from '@/features/phone/components/session-header'

/** One session: its timeline and a composer that stays above the keyboard. */
export function SessionScreen() {
  return <ChatStage Header={SessionHeader} />
}
