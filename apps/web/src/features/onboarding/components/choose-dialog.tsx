import { ArrowClockwiseIcon, FolderOpenIcon, PlugsConnectedIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'

import { InlineError } from '@/components/inline-error'
import { PathChoice } from '@/features/onboarding/components/path-choice'
import { machineName } from '@/features/onboarding/utils/machine-name'

/** The first-workspace question: a folder on the machine running Fregat, or on another one. */
export function ChooseDialog({
  error,
  machine,
  onLocal,
  onOpenChange,
  onRemote,
  onRetry,
  open,
}: {
  readonly error: string | null
  readonly machine: string | null
  readonly onLocal: () => void
  readonly onOpenChange: (open: boolean) => void
  readonly onRemote: () => void
  readonly onRetry?: () => void
  readonly open: boolean
}) {
  const name = machineName(machine)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className='max-h-[calc(100dvh-2rem)] gap-(--density-section-gap) overflow-y-auto overscroll-contain sm:max-w-md'
        data-first-workspace-dialog=''
      >
        <DialogHeader>
          <DialogTitle>Choose a project</DialogTitle>
          <DialogDescription>
            Each chat works in a project folder. Pick the machine that holds it.
          </DialogDescription>
        </DialogHeader>
        <div className='flex flex-col gap-(--density-control-gap)'>
          <PathChoice
            detail={`Browse the folders on ${name}, the machine running Fregat.`}
            icon={FolderOpenIcon}
            title={`Choose a folder on ${name}`}
            onSelect={onLocal}
          />
          <PathChoice
            detail='Connect over SSH or a server address, then choose a folder there.'
            icon={PlugsConnectedIcon}
            title='Connect a remote machine'
            onSelect={onRemote}
          />
        </div>
        {error ? (
          <div className='flex flex-col items-start gap-(--density-control-gap)'>
            <InlineError message={error} title='Open project' />
            {onRetry ? (
              <Button size='sm' type='button' variant='outline' onClick={onRetry}>
                <ArrowClockwiseIcon data-icon='inline-start' />
                Try again
              </Button>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
