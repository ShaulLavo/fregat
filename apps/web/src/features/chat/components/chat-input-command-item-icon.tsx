import { FileTypeIcon } from '@/components/file-type-icon'
import { SparkleIcon, TerminalWindowIcon } from '@phosphor-icons/react'

import { iconForEntry } from '@/lib/file-icons'

import type { ChatInputCommandItem } from '@/features/chat/utils/input-logic'

export function ChatInputCommandItemIcon({ item }: { item: ChatInputCommandItem }) {
  if (item.type === 'skill') {
    return <SparkleIcon className='text-muted-foreground size-(--icon-size) shrink-0' />
  }
  if (item.type === 'slash-command' || item.type === 'provider-command') {
    return <TerminalWindowIcon className='text-muted-foreground size-(--icon-size) shrink-0' />
  }

  const icon = iconForEntry({ name: item.label, type: item.entryType })

  return <FileTypeIcon className='size-(--icon-size) shrink-0' icon={icon} />
}
