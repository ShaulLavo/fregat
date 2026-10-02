import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useEffectEvent, useState } from 'react'
import { DeferredFilePickerDialog } from '@/components/deferred-file-picker-dialog'
import type { FilePickerMode } from '@/features/file-picker/utils/model'
import type { PickedFsEntry } from '@/lib/file-system-types'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import {
  nativePickerCapabilitiesOptions,
  nativeSelectionOptions,
} from '@/components/utils/native-picker'
import { runMutation } from '@/lib/mutations/run'
import { clientErrorDescription, toClientError } from '@/lib/client-error-taxonomy'
import { toastError } from '@/lib/toast-error'

type UsePickEntryOptions = {
  accept?: readonly string[]
  mode?: FilePickerMode
  open: boolean
  value: PickedFsEntry | null
  onOpenChange: (open: boolean) => void
  onPick: (entry: PickedFsEntry) => void
}

export function usePickEntry({
  accept,
  mode = 'folder',
  open,
  value,
  onOpenChange,
  onPick,
}: UsePickEntryOptions) {
  const queryClient = useQueryClient()
  const client = clientForQueryClient(queryClient)
  const capabilities = useQuery({ ...nativePickerCapabilitiesOptions(client), enabled: open })
  const [fallback, setFallback] = useState(false)
  const native = capabilities.data?.nativePicker === true && !fallback
  const startingPath = value?.path
  const picked = useEffectEvent((entry: PickedFsEntry | null) => {
    if (entry) onPick(entry)
    onOpenChange(false)
  })
  const failed = useEffectEvent((error: unknown) => {
    const failure = toClientError(error)
    toastError(
      'Could not open file chooser',
      { description: clientErrorDescription(failure) },
      failure,
    )
    setFallback(true)
  })

  useEffect(() => {
    if (!open) {
      setFallback(false)
      return
    }
    if (!native) return
    const controller = new AbortController()
    // The StrictMode rehearsal disposes its effect before this starts a chooser.
    queueMicrotask(() => {
      if (controller.signal.aborted) return
      void runMutation(queryClient, nativeSelectionOptions(queryClient), {
        request: { accept, mode, startingPath },
        signal: controller.signal,
      }).then(
        (entry) => {
          if (!controller.signal.aborted) picked(entry)
        },
        (error: unknown) => {
          if (!controller.signal.aborted) failed(error)
        },
      )
    })
    return () => controller.abort()
  }, [accept, mode, native, open, queryClient, startingPath])

  if (!open || native || (capabilities.isPending && !fallback)) return null
  return (
    <DeferredFilePickerDialog
      accept={accept}
      mode={mode}
      onOpenChange={onOpenChange}
      onPick={onPick}
      open={open}
      value={value}
    />
  )
}
