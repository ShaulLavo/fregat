import { FolderOpenIcon } from '@phosphor-icons/react'

import { Button } from '@workspace/ui/components/button'

export function EmptyWorkspace({ onChooseFolder }: { onChooseFolder: () => void }) {
  return (
    <section className='relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-4 py-10'>
      <div className='bg-background backdrop-material flex w-full max-w-sm flex-col items-center gap-4 rounded-lg p-6 text-center'>
        <span className='bg-muted flex size-11 items-center justify-center rounded-md'>
          <FolderOpenIcon className='size-(--icon-size)' weight='duotone' />
        </span>
        <div>
          <h2 className='text-sm font-medium'>Open a folder</h2>
          <p className='text-muted-foreground mt-1 text-xs'>Pick a folder to browse its files.</p>
        </div>
        <Button onClick={onChooseFolder} type='button'>
          Choose folder
        </Button>
      </div>
    </section>
  )
}
