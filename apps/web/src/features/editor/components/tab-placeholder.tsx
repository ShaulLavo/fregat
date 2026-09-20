import type { ReactNode } from 'react'
import type { TabId } from '@/lib/documents/utils/types'
import { useFocusTarget } from '@/lib/focus/hooks/use-target'

export function EditorTabPlaceholder({
  children,
  tabId,
}: {
  readonly children: ReactNode
  readonly tabId?: TabId
}) {
  const { ref } = useFocusTarget<HTMLDivElement>(
    {
      area: 'editor',
      id: { kind: 'editor', key: tabId ?? '', surface: 'placeholder', tabId },
      onIntent: (intent, element) => {
        if (intent !== 'focus') return false
        element.focus()
        return true
      },
    },
    tabId !== undefined,
  )
  return (
    <div className='focus-ring-inset h-full min-h-0 outline-none' ref={ref} tabIndex={-1}>
      {children}
    </div>
  )
}
