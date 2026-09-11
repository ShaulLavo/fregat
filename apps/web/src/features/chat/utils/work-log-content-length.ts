import type { ChatWorkLogEntry } from '@/features/chat/utils/work-log'
import { workRowSections } from '@/features/chat/utils/work-row'

export function workLogContentLength(entries: readonly ChatWorkLogEntry[]) {
  return entries.reduce(
    (length, entry) =>
      length + workRowSections(entry).reduce((size, section) => size + section.value.length, 1),
    0,
  )
}
