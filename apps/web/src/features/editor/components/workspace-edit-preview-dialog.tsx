import {
  ArrowsClockwiseIcon,
  FileDashedIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderSimpleIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { RingLoader } from '@workspace/ui/components/ring-loader'
import { Spinner } from '@workspace/ui/components/spinner'
import { useLayoutEffect, useRef } from 'react'

import { useWorkspaceEditState } from '@/features/editor/hooks/use-workspace-edit-state'
import { useWorkspaceEditService } from '@/features/editor/providers/workspace-edit-context'
import type { WorkspaceEditPreviewRow } from '@/features/editor/state/workspace-edit-service'
import { selectWorkspaceEditPreview } from '@/features/editor/utils/workspace-edit-dialog-state'
import { useFocusService } from '@/lib/focus/hooks/use-service'
import type { FocusTargetToken } from '@/lib/focus/state/service'

export function WorkspaceEditPreviewDialog() {
  const service = useWorkspaceEditService()
  const state = useWorkspaceEditState(selectWorkspaceEditPreview)
  const focusService = useFocusService()
  const restoreTarget = useRef<FocusTargetToken | null>(null)
  const wasOpen = useRef(false)
  const preparing = state?.phase === 'preparing'
  const awaiting = state?.phase === 'awaiting-confirmation'
  const processing = state?.phase === 'committing' || state?.phase === 'finalizing'
  const stale = state?.phase === 'stale'
  const open = state !== null
  const preview = state?.preview

  useLayoutEffect(() => {
    if (open) return
    const captureRestoreTarget = () => {
      const { currentOwner } = focusService.getSnapshot()
      if (!currentOwner || currentOwner.capabilities.overlay) return
      restoreTarget.current = currentOwner.token
    }
    captureRestoreTarget()
    const unsubscribe = focusService.subscribe(captureRestoreTarget)
    return () => {
      unsubscribe()
    }
  }, [focusService, open])

  useLayoutEffect(() => {
    const closed = wasOpen.current && !open
    wasOpen.current = open
    if (!closed || !restoreTarget.current) return
    if (!focusService.isRegistered(restoreTarget.current)) return
    void focusService.request({ kind: 'target', token: restoreTarget.current }).completion
  }, [focusService, open])

  const close = () => {
    if (awaiting && preview) {
      service.cancelPreview(preview.operationId)
      return
    }
    if (stale) service.dismissResult()
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && close()}>
      <DialogContent
        className='max-h-[min(760px,calc(100vh-2rem))] w-[min(760px,calc(100vw-2rem))] max-w-none overflow-hidden border sm:max-w-none'
        finalFocus={false}
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>{preview?.label ?? 'Preparing workspace edit'}</DialogTitle>
          <DialogDescription>
            Review one atomic change across live buffers and workspace files.
          </DialogDescription>
        </DialogHeader>

        {preparing ? (
          <LoadingState className='grid gap-2 py-2' label='Preparing workspace edit preview'>
            <div className='skeleton-sweep h-10 rounded-md' />
            <div className='skeleton-sweep h-16 rounded-md' />
            <div className='skeleton-sweep h-12 rounded-md' />
          </LoadingState>
        ) : null}

        {preview ? (
          <div className='min-h-0 overflow-y-auto pr-1'>
            <div className='text-muted-foreground mb-3 flex items-center justify-between text-xs'>
              <span className='tabular-nums'>
                {preview.operationCount} {preview.operationCount === 1 ? 'operation' : 'operations'}
              </span>
              <span>{preview.undoCategory === 'editor' ? 'Editor undo' : 'Workspace undo'}</span>
            </div>

            {preview.annotations.length > 0 ? (
              <div className='border-warning/30 bg-warning/10 mb-3 grid gap-1 rounded-lg border p-3'>
                {preview.annotations.map((annotation) => (
                  <div className='flex items-start gap-2 text-xs' key={annotation.id}>
                    <WarningCircleIcon className='text-warning mt-0.5 size-3.5 shrink-0' />
                    <span>
                      <span className='font-medium'>{annotation.label}</span>
                      {annotation.description ? ` — ${annotation.description}` : ''}
                      {annotation.needsConfirmation ? ' — confirmation required' : ''}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            {preview.rows.length === 0 ? (
              <EmptyState
                align='start'
                description='The server returned no file or buffer operations to apply.'
                title='No workspace changes'
              />
            ) : (
              <ol className='grid gap-2'>
                {preview.rows.map((row) => (
                  <li
                    className='bg-card rounded-lg border p-3'
                    key={`${row.index}:${row.path}`}
                    title={resourcePathLabel(row)}
                  >
                    <div className='flex min-w-0 items-center gap-2 text-xs'>
                      {rowIcon(row)}
                      <span className='truncate font-medium'>{operationLabel(row)}</span>
                      <span className='text-muted-foreground ml-auto shrink-0'>
                        {row.ignored ? 'ignored / no-op' : targetLabel(row)}
                      </span>
                    </div>
                    <div className='text-muted-foreground text-2xs mt-1 truncate font-mono'>
                      {resourcePathLabel(row)}
                    </div>
                    {row.beforeText !== undefined && row.afterText !== undefined ? (
                      <div className='text-2xs mt-2 grid max-h-52 grid-cols-2 overflow-auto rounded-lg border font-mono leading-relaxed'>
                        <pre className='bg-diff-removed/10 text-diff-removed min-w-0 overflow-visible p-2 whitespace-pre-wrap'>
                          {row.beforeText}
                        </pre>
                        <pre className='bg-diff-added/10 text-diff-added min-w-0 overflow-visible border-l p-2 whitespace-pre-wrap'>
                          {row.afterText}
                        </pre>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}

            <div className='text-muted-foreground mt-3 grid gap-1 text-xs'>
              <p>
                Open buffers remain unsaved. Unopened files and resource operations are written.
              </p>
              {preview.undoCategory === 'workspace' ? (
                <p>Undo this group with the separate workspace undo command.</p>
              ) : null}
            </div>
          </div>
        ) : null}

        {stale ? (
          <div className='border-warning/30 bg-warning/10 text-warning flex items-start gap-2 rounded-lg border p-3 text-xs'>
            <WarningCircleIcon className='mt-0.5 size-3.5 shrink-0' />
            <span>{state.message ?? 'This preview is stale. Request the edit again.'}</span>
          </div>
        ) : null}

        {processing ? (
          <div className='text-muted-foreground flex items-center gap-2 text-xs' role='status'>
            <RingLoader aria-hidden='true' className='size-4' />
            {state.phase === 'finalizing' ? 'Finalizing atomic change…' : 'Applying atomic change…'}
          </div>
        ) : null}

        <DialogFooter>
          <Button disabled={processing} onClick={close} type='button' variant='outline'>
            {stale ? 'Close' : 'Cancel'}
          </Button>
          <Button
            disabled={!awaiting || processing}
            onClick={() => preview && service.confirmPreview(preview.operationId)}
            type='button'
          >
            {processing ? (
              <Spinner aria-hidden='true' data-icon='inline-start' role='presentation' />
            ) : (
              <ArrowsClockwiseIcon data-icon='inline-start' />
            )}
            Apply all
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function targetLabel(row: WorkspaceEditPreviewRow): string {
  if (row.targetKind) return row.targetKind
  return row.kind
}

function operationLabel(row: WorkspaceEditPreviewRow): string {
  if (row.kind === 'text-document') return 'Edit text'
  if (row.kind === 'create') return 'Create file'
  if (row.kind === 'rename') return 'Rename file'
  return 'Delete file'
}

function resourcePathLabel(row: WorkspaceEditPreviewRow): string {
  if (row.fromPath && row.toPath) return `${row.fromPath} → ${row.toPath}`
  return row.path
}

function rowIcon(row: WorkspaceEditPreviewRow) {
  if (row.kind === 'create') return <FilePlusIcon className='text-success size-4 shrink-0' />
  if (row.kind === 'delete') return <FileDashedIcon className='text-destructive size-4 shrink-0' />
  if (row.kind === 'rename') return <FolderSimpleIcon className='text-info size-4 shrink-0' />
  return <FileTextIcon className='text-foreground size-4 shrink-0' />
}
