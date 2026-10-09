import { QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@workspace/ui/components/button'

import { FilePickerDialog } from '@/components/file-picker-dialog'
import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'

/** The folder the list is read from: home by default, a project to see its local and project servers. */
export function McpFolderField({
  folder,
  onChange,
}: {
  readonly folder: string | null
  readonly onChange: (folder: string | null) => void
}) {
  const owner = useSettingsOwner()
  const [picking, setPicking] = useState(false)

  return (
    <div className='flex min-w-0 flex-wrap items-center gap-(--density-control-gap)'>
      <span className='text-muted-foreground text-xs'>Folder</span>
      <span
        className='text-foreground min-w-0 flex-1 truncate font-mono text-xs'
        data-mcp-folder
        title={folder ?? 'Home folder'}
      >
        {folder ?? 'Home folder'}
      </span>
      <Button onClick={() => setPicking(true)} size='sm' variant='outline'>
        Choose folder…
      </Button>
      {folder ? (
        <Button onClick={() => onChange(null)} size='sm' variant='ghost'>
          Home
        </Button>
      ) : null}
      {picking ? (
        <QueryClientProvider client={owner}>
          <FilePickerDialog
            onOpenChange={setPicking}
            onPick={(entry) => {
              onChange(entry.path)
              setPicking(false)
            }}
            open
            value={null}
          />
        </QueryClientProvider>
      ) : null}
    </div>
  )
}
