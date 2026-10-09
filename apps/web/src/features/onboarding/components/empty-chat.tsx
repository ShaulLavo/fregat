import { FolderOpenIcon, PlugsConnectedIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Textarea } from '@workspace/ui/components/textarea'

import { machineName } from '@/features/onboarding/utils/machine-name'

/**
 * The new-chat view before any project is open: the composer is shown but takes no message
 * until a folder is chosen, and both ways to choose one stay on screen.
 */
export function EmptyChat({
  machine,
  onChooseLocal,
  onChooseRemote,
}: {
  readonly machine: string | null
  readonly onChooseLocal: () => void
  readonly onChooseRemote: () => void
}) {
  return (
    <section
      aria-label='New chat'
      className='flex min-h-0 flex-1 flex-col items-center justify-center gap-(--density-section-gap) px-(--density-section-padding) py-10'
      data-first-workspace=''
    >
      <h2 className='text-foreground text-center text-sm font-semibold'>What should we work on?</h2>
      <div className='flex w-full max-w-xl flex-col gap-(--density-control-gap)'>
        <Textarea
          aria-label='Message'
          className='min-h-20 resize-none'
          disabled
          placeholder='Choose a project to start a chat.'
        />
        <div className='flex flex-wrap items-center gap-(--density-control-gap)'>
          <Button size='sm' type='button' variant='secondary' onClick={onChooseLocal}>
            <FolderOpenIcon data-icon='inline-start' />
            Folder on {machineName(machine)}
          </Button>
          <Button size='sm' type='button' variant='ghost' onClick={onChooseRemote}>
            <PlugsConnectedIcon data-icon='inline-start' />
            Remote machine
          </Button>
        </div>
      </div>
    </section>
  )
}
