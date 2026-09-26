import { Switch } from '@workspace/ui/components/switch'
import { useId } from 'react'

import type { WorktreeRemovalChoice } from '@/features/chat-mode/utils/worktree-removal-choice'

const NOTES: Record<Exclude<WorktreeRemovalChoice, 'offer'>, string> = {
  automatic:
    'Its worktree is removed once the session stops, unless it has changes or ignored files.',
  shared: 'Another session uses this worktree, so it stays.',
  kept: 'The checkout and its changes stay on disk. Use Manage worktrees for separate cleanup.',
}

/** The delete dialog's word on the session's worktree, with the switch to remove it too. */
export function SessionDeleteWorktreeOption({
  choice,
  checked,
  onCheckedChange,
}: {
  readonly choice: WorktreeRemovalChoice
  readonly checked: boolean
  readonly onCheckedChange: (checked: boolean) => void
}) {
  const id = useId()
  if (choice !== 'offer') return <p className='text-muted-foreground text-xs'>{NOTES[choice]}</p>
  return (
    <div className='flex items-start gap-2'>
      <Switch id={id} checked={checked} size='sm' onCheckedChange={onCheckedChange} />
      <label className='flex flex-col gap-0.5 text-xs' htmlFor={id}>
        Also remove its worktree
        <span className='text-muted-foreground'>
          Once the session stops, if it has no changes or ignored files. Its branch stays.
        </span>
      </label>
    </div>
  )
}
