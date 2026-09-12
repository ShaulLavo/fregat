import { Button } from '@workspace/ui/components/button'

import type { FilesystemConflict } from '@/features/editor/state/conflict-state'
import { displayPath } from '@/lib/path-formatters'

type FilesystemConflictToastProps = {
  conflict: FilesystemConflict
  onOpenDiff: () => void
  onOverrideLocal: () => void
  onOverrideRemote: () => void
}

export function FilesystemConflictToast({
  conflict,
  onOpenDiff,
  onOverrideLocal,
  onOverrideRemote,
}: FilesystemConflictToastProps) {
  return (
    <div className='border-destructive/40 bg-background text-foreground w-[360px] max-w-[calc(100vw-2rem)] rounded-lg border p-(--density-section-padding) shadow-md'>
      <div className='text-sm font-medium'>Unsaved file conflict</div>
      <div className='text-muted-foreground mt-1 text-xs leading-5'>
        {conflictDescription(conflict)}
      </div>
      <div className='mt-(--density-section-gap) flex flex-wrap gap-(--density-control-gap)'>
        <Button size='sm' type='button' onClick={onOverrideLocal}>
          Override with local
        </Button>
        <Button size='sm' type='button' variant='secondary' onClick={onOverrideRemote}>
          Override with remote
        </Button>
        <Button size='sm' type='button' variant='ghost' onClick={onOpenDiff}>
          Open conflict editor
        </Button>
      </div>
    </div>
  )
}

function conflictDescription(conflict: FilesystemConflict) {
  if (conflict.eventType === 'deleted') {
    return `${displayPath(conflict.localPath)} was deleted on disk. Choose which version to keep.`
  }
  if (conflict.eventType === 'renamed') {
    return `${displayPath(conflict.localPath)} was renamed to ${displayPath(conflict.remotePath)} on disk. Choose which content to keep.`
  }

  return `${displayPath(conflict.localPath)} changed on disk. Choose which version to keep.`
}
