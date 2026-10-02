import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useEffectEvent, useState } from 'react'
import { DeferredFilePickerDialog } from '@/components/deferred-file-picker-dialog'
import type { PickedFsEntry } from '@/lib/file-system-types'
import type { UsePickEntryOptions } from '@/components/use-pick-entry'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import {
  nativePickerCapabilitiesOptions,
  notifyPickerCapabilitiesResult,
  nativeSelectionOptions,
} from '@/components/utils/native-picker'
import { runMutation } from '@/lib/mutations/run'
import { clientErrorDescription, toClientError } from '@/lib/client-error-taxonomy'
import { toastError } from '@/lib/toast-error'

export function EntryPicker({
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
  const native = capabilities.isSuccess && capabilities.data?.nativePicker === true && !fallback
  const startingPath = value?.path
  const picked = useEffectEvent((entry: PickedFsEntry | null) => {
    if (entry) onPick(entry)
    onOpenChange(false)
  })
  const failed = useEffectEvent((error: unknown) => {
    const failure = toClientError(error)
    toastError(
      'Could not open file chooser',
      { description: [failure.why, clientErrorDescription(failure)].filter(Boolean).join(' ') },
      failure,
    )
    setFallback(true)
  })

  useEffect(() => {
    if (!open || capabilities.isPending) return
    notifyPickerCapabilitiesResult(queryClient, capabilities.error)
  }, [open, capabilities.isPending, capabilities.error, queryClient])

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
