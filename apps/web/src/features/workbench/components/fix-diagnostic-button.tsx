import { SparkleIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'

import { useKeyShortcuts } from '@/keymap/hooks/use-key-shortcuts'

/**
 * Fix with AI beside one problem. Out of the Tab order so the list keeps one stop; the
 * keyboard reaches it as Mod+. on the active problem.
 */
export function FixDiagnosticButton({
  pending,
  onFix,
}: {
  readonly pending: boolean
  readonly onFix: () => void
}) {
  return (
    <Button
      aria-keyshortcuts={useKeyShortcuts('workspace.fixDiagnostic')}
      className='shrink-0'
      disabled={pending}
      size='xs'
      tabIndex={-1}
      type='button'
      variant='ghost'
      onClick={onFix}
    >
      {pending ? <Spinner /> : <SparkleIcon data-icon='inline-start' />}
      Fix with AI
    </Button>
  )
}
