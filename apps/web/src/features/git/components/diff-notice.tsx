import { WarningCircleIcon } from '@phosphor-icons/react'
import { EmptyState } from '@workspace/ui/components/empty-state'

/**
 * Every non-renderable diff still says something. A diff pane must never be a
 * blank rectangle the reader has to interpret.
 */
export function DiffNotice({
  message,
  tone = 'muted',
}: {
  message: string
  tone?: 'error' | 'muted'
}) {
  return (
    <EmptyState
      className='p-6'
      icon={tone === 'error' ? <WarningCircleIcon /> : undefined}
      iconPosition='inline'
      title={message}
      tone={tone}
    />
  )
}
