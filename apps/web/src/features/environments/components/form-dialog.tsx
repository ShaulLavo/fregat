import type { ComponentProps } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { MachineForm } from '@/components/machine-form'

export function FormDialog(props: ComponentProps<typeof MachineForm>) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onCancel()
      }}
    >
      <DialogContent className='max-h-[80dvh] w-[calc(100vw_-_2rem)] gap-6 overflow-y-auto p-6 sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>{props.name ? 'Edit machine' : 'Connect machine'}</DialogTitle>
          <DialogDescription>
            {props.name
              ? 'Update this machine’s connection details.'
              : 'Connect to a Platform server on another machine.'}
          </DialogDescription>
        </DialogHeader>
        <MachineForm {...props} />
      </DialogContent>
    </Dialog>
  )
}
