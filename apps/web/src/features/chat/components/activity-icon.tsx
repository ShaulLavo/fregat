import {
  BrainIcon,
  FileTextIcon,
  InfoIcon,
  ListChecksIcon,
  ShieldCheckIcon,
  TerminalWindowIcon,
  UserCircleIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import type { ChatActivityIconKey } from '@/features/chat/utils/activity-presentation'

const icons = {
  approval: ShieldCheckIcon,
  context: FileTextIcon,
  error: WarningCircleIcon,
  info: InfoIcon,
  task: ListChecksIcon,
  thinking: BrainIcon,
  tool: TerminalWindowIcon,
  'user-input': UserCircleIcon,
}

export function ActivityIcon({ icon }: { icon: ChatActivityIconKey }) {
  const Icon = icons[icon]
  return <Icon aria-hidden='true' className='size-3.5 shrink-0' />
}
