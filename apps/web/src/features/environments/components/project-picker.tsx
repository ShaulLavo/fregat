import { QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'

import { FilePickerDialog } from '@/components/file-picker-dialog'
import { Phase } from '@/lib/environments/components/phase'
import { useNavigation } from '@/hooks/use-navigation'
import { queryClientFor } from '@/lib/environments/state/query-clients'
import type { ConfirmedMachine } from '@/lib/environments/utils/machines'
import { openPickedMachineProject } from '@/state/project-picker'

export function ProjectPicker({
  machines,
  onClose,
}: {
  readonly machines: readonly ConfirmedMachine[]
  readonly onClose: () => void
}) {
  const navigation = useNavigation()
  const [selected, setSelected] = useState<ConfirmedMachine | null>(() =>
    machines.length === 1 && machines[0]?.phase === 'live' ? machines[0] : null,
  )
  if (selected) {
    return (
      <QueryClientProvider key={selected.environmentId} client={queryClientFor(selected.origin)}>
        <FilePickerDialog
          open
          mode='folder'
          value={null}
          onOpenChange={(open) => {
            if (!open) onClose()
          }}
          onPick={(entry) => {
            void openPickedMachineProject(navigation, selected, entry.path)
            onClose()
          }}
        />
      </QueryClientProvider>
    )
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className='max-w-sm'>
        <DialogHeader>
          <DialogTitle>Add project</DialogTitle>
          <DialogDescription>Choose the machine that contains the folder.</DialogDescription>
        </DialogHeader>
        <div className='flex flex-col gap-1'>
          {machines.map((machine) => (
            <Button
              key={machine.environmentId}
              className='justify-start gap-2'
              variant='ghost'
              disabled={machine.phase !== 'live'}
              onClick={() => setSelected(machine)}
            >
              <Phase phase={machine.phase} label={machine.label ?? machine.name} />
              <span className='min-w-0 flex-1 truncate text-left'>
                {machine.label ?? machine.name}
              </span>
              <span className='text-muted-foreground text-xs'>{machine.phase}</span>
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
