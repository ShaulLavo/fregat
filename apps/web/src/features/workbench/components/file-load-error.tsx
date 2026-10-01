import { useFileLimit } from '@/features/workbench/hooks/use-file-limit'
import { formatSize } from '@/lib/path-formatters'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { WarningCircleIcon } from '@phosphor-icons/react'
import { PaneBar } from '@workspace/ui/components/pane-bar'
import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'
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
  retained = false,
  onOpenReadOnly,
}: {
  path: FilesystemPath
  message: string
  hasContent: boolean
  retained?: boolean
  onOpenReadOnly: () => void
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
  const category = toClientError(query.error).category
  const missing = category === 'not_found'
  const tooLarge = category === 'too_large'
  const limits = useFileLimit(path, tooLarge)
  let description = message
  if (tooLarge && limits.data)
    description = `${formatSize(limits.data.size)} exceeds the ${formatSize(limits.data.limit)} editing limit. Read-only viewing loads sections of the file.`
  if (missing && hasContent) description = 'Deleted on disk. Save to recreate this file.'
  if (missing && !hasContent) description = 'This file no longer exists.'
  if (create.error) description = clientErrorMessage(create.error)

  return (
    <PaneBar
      as={retained ? 'header' : 'div'}
      aria-label={retained ? 'File read error' : undefined}
      role='status'
      className='bg-background text-muted-foreground text-xs'
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
          {create.isPending ? <Spinner /> : null}
          Create File
        </Button>
      ) : null}
      {tooLarge && !hasContent ? (
        <Button size='sm' variant='secondary' onClick={onOpenReadOnly}>
          Open read-only
        </Button>
      ) : null}
      <Button
        size='sm'
        variant='ghost'
        disabled={query.isFetching || create.isPending}
        onClick={() => void query.refetch()}
      >
        {query.isFetching ? <Spinner /> : null}
        Retry
      </Button>
    </PaneBar>
  )
}
