import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RenderErrorBoundary } from '@workspace/ui/patterns/render-error-boundary'
import { DeferredFilePickerDialog } from '@/components/deferred-file-picker-dialog'
import { entryPickerModuleQueryOptions } from '@/components/utils/entry-picker-query'
import type { PickedFsEntry } from '@/lib/file-system-types'
import { resourceQueryClient } from '@/lib/resources/state/query-client'

export type UsePickEntryOptions = {
  open: boolean
  value: PickedFsEntry | null
  onOpenChange: (open: boolean) => void
  onPick: (entry: PickedFsEntry) => void
}

export function usePickEntry(options: UsePickEntryOptions) {
  const queryClient = useQueryClient()
  const runtime = useQuery(
    { ...entryPickerModuleQueryOptions, enabled: options.open },
    resourceQueryClient,
  )
  if (!options.open || runtime.isPending) return null
  if (runtime.isError) return <DeferredFilePickerDialog {...options} />

  const { EntryPicker } = runtime.data
  return (
    <RenderErrorBoundary label='file picker' resetKeys={[queryClient]}>
      <EntryPicker {...options} />
    </RenderErrorBoundary>
  )
}
