import { useQuery } from '@tanstack/react-query'
import type { ComponentProps } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { Spinner } from '@workspace/ui/components/spinner'
import { RenderErrorBoundary } from '@workspace/ui/patterns/render-error-boundary'

import type { FilePickerDialog } from '@/components/file-picker-dialog'
import { ModuleLoadError } from '@/components/module-load-error'
import { filePickerDialogQueryOptions } from '@/features/file-picker/utils/dialog-query'
import { resourceQueryClient } from '@/lib/resources/state/query-client'

export function DeferredFilePickerDialog(props: ComponentProps<typeof FilePickerDialog>) {
  const query = useQuery(
    { ...filePickerDialogQueryOptions, enabled: props.open },
    resourceQueryClient,
  )
  if (!props.open) return null
  if (query.isSuccess) {
    const { FilePickerDialog: View } = query.data
    return (
      <RenderErrorBoundary label='file picker'>
        <View {...props} />
      </RenderErrorBoundary>
    )
  }

  return (
    <Dialog open onOpenChange={props.onOpenChange}>
      <DialogContent finalFocus={returnFocusUnlessLoaded} showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Open {props.mode === 'file' ? 'file' : 'folder'}</DialogTitle>
          <DialogDescription>Browse files and folders.</DialogDescription>
        </DialogHeader>
        {query.isPending ? (
          <Spinner
            className='mx-auto my-(--density-section-padding)'
            size='md'
            label='Loading file picker'
          />
        ) : (
          <ModuleLoadError label='file picker' onRetry={() => void query.refetch()} />
        )}
      </DialogContent>
    </Dialog>
  )
}

// Loading swaps this shell for the real dialog, whose input already holds focus by then.
function returnFocusUnlessLoaded() {
  return (
    resourceQueryClient.getQueryState(filePickerDialogQueryOptions.queryKey)?.status !== 'success'
  )
}
