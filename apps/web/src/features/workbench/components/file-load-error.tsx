import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { WarningCircleIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { OrbitLoader } from '@workspace/ui/components/orbit-loader'
import { useEditorRuntime } from '@/features/editor/hooks/use-runtime'
import { createMissingFileOptions } from '@/features/workbench/utils/create-missing-file'
import { toClientError, clientErrorMessage } from '@/lib/client-error-taxonomy'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { useUnavailableEnvironment } from '@/lib/environments/hooks/use-unavailable-environment'
import { fileSnapshotQueryOptions } from '@/lib/file-snapshot-query-cache'

export function FileLoadError({
  path,
  message,
  hasContent,
}: {
  path: FilesystemPath
  message: string
  hasContent: boolean
}) {
  const queryClient = useQueryClient()
  const { workspaceEditService } = useEditorRuntime()
  const canMutate = useSyncExternalStore(
    workspaceEditService.subscribe,
    workspaceEditService.canMutateWorkspace,
  )
  const unavailable = useUnavailableEnvironment()
  const query = useQuery({ ...fileSnapshotQueryOptions(path), enabled: false })
  const create = useMutation(createMissingFileOptions(queryClient, path))
  const missing = toClientError(query.error).category === 'not_found'
  let description = message
  if (missing && hasContent) description = 'Deleted on disk. Save to recreate this file.'
  if (missing && !hasContent) description = 'This file no longer exists.'
  if (create.error) description = clientErrorMessage(create.error)

  return (
    <div
      role='status'
      className='bg-background text-muted-foreground flex shrink-0 items-center gap-2 px-3 py-2 text-xs'
    >
      <WarningCircleIcon className='size-(--icon-size) shrink-0' />
      <span className='min-w-0 flex-1'>{description}</span>
      {missing && !hasContent ? (
        <Button
          size='sm'
          variant='secondary'
          disabled={!canMutate || Boolean(unavailable) || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? <OrbitLoader /> : null}
          Create File
        </Button>
      ) : null}
      <Button
        size='sm'
        variant='ghost'
        disabled={query.isFetching || create.isPending}
        onClick={() => void query.refetch()}
      >
        {query.isFetching ? <OrbitLoader /> : null}
        Retry
      </Button>
    </div>
  )
}
