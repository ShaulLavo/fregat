import {
  CodeIcon,
  FilesIcon,
  GitBranchIcon,
  MagnifyingGlassIcon,
  ScrollIcon,
  TerminalIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import type { ChatModeToolTab } from '@/features/chat-mode/utils/panels'

export function ToolTabIcon({ tab }: { readonly tab: ChatModeToolTab }) {
  if (tab === 'editor') return <CodeIcon className='size-(--icon-size)' />
  if (tab === 'files') return <FilesIcon className='size-(--icon-size)' />
  if (tab === 'git') return <GitBranchIcon className='size-(--icon-size)' />
  if (tab === 'logs') return <ScrollIcon className='size-(--icon-size)' />
  if (tab === 'problems') return <WarningCircleIcon className='size-(--icon-size)' />
  if (tab === 'search') return <MagnifyingGlassIcon className='size-(--icon-size)' />

  return <TerminalIcon className='size-(--icon-size)' />
}
