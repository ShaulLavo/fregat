import { WorkspaceEditPreviewLoading } from '@/features/editor/components/workspace-edit-preview-loading'
import { Alert, AlertDescription } from '@workspace/ui/components/alert'
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
import { Spinner } from '@workspace/ui/components/spinner'
import { DiffEditor } from '@/features/editor/components/diff-editor'
import { operationDiffAttachment } from '@/lib/diff-attachment'
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
        className='flex max-h-[min(760px,calc(100vh-2rem))] w-[min(760px,calc(100vw-2rem))] max-w-none flex-col overflow-hidden sm:max-w-none'
        finalFocus={false}
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>{preview?.label ?? 'Preparing changes'}</DialogTitle>
          <DialogDescription>
            Review every file this edit changes. It changes all of them together, or none.
          </DialogDescription>
        </DialogHeader>

        {preparing ? <WorkspaceEditPreviewLoading /> : null}

        {preview ? (
          <div className='min-h-0 flex-1 overflow-y-auto pr-1'>
            <div className='text-muted-foreground mb-3 flex items-center justify-between text-xs'>
              <span className='tabular-nums'>
                {preview.operationCount} {preview.operationCount === 1 ? 'change' : 'changes'}
              </span>
              <span>
                {preview.undoCategory === 'editor' ? 'Undo in this file' : 'Undo across all files'}
              </span>
            </div>

            {preview.annotations.length > 0 ? (
              <div className='bg-warning/10 mb-3 grid gap-1 rounded-lg p-3'>
                {preview.annotations.map((annotation) => (
                  <div className='flex items-start gap-2 text-xs' key={annotation.id}>
                    <WarningCircleIcon className='text-warning mt-0.5 size-(--icon-size-sm) shrink-0' />
                    <span>
                      <span className='font-medium'>{annotation.label}</span>
                      {annotation.description ? ` — ${annotation.description}` : ''}
                      {annotation.needsConfirmation ? ' — check before applying' : ''}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            {preview.rows.length === 0 ? (
              <EmptyState
                align='start'
                description='This edit contains no changes.'
                title='Nothing to change'
              />
            ) : (
              <ol className='grid gap-2'>
                {preview.rows.map((row) => (
                  <li
                    className='bg-card rounded-lg p-3'
                    key={`${row.index}:${row.path}`}
                    title={resourcePathLabel(row)}
                  >
                    <div className='flex min-w-0 items-center gap-2 text-xs'>
                      {rowIcon(row)}
                      <span className='truncate font-medium'>{operationLabel(row)}</span>
                      <span className='text-muted-foreground ml-auto shrink-0'>
                        {row.ignored ? 'No change' : targetLabel(row)}
                      </span>
                    </div>
                    <div className='text-muted-foreground text-2xs mt-1 truncate font-mono'>
                      {resourcePathLabel(row)}
                    </div>
                    {row.comparison && row.file ? (
                      <div className='mt-2 h-52 min-w-0 overflow-hidden'>
                        <DiffEditor
                          attachment={operationDiffAttachment(row.comparison, row.file)}
                          mode='stacked'
                        />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}

            <div className='text-muted-foreground mt-3 grid gap-1 text-xs'>
              <p>
                Open files get the change as unsaved edits. Closed files, and files created, renamed
                or deleted, are saved to disk right away.
              </p>
              {preview.undoCategory === 'workspace' ? (
                <p>To undo it, use Undo multi-file edit or the file's History tab.</p>
              ) : null}
            </div>
          </div>
        ) : null}

        {stale ? (
          <Alert variant='warning'>
            <WarningCircleIcon />
            <AlertDescription>
              {state.message ??
                'The files changed after this preview was made. Run the edit again.'}
            </AlertDescription>
          </Alert>
        ) : null}

        {processing ? (
          <div className='text-muted-foreground flex items-center gap-2 text-xs' role='status'>
            <Spinner size='sm' aria-hidden='true' />
            {state.phase === 'finalizing' ? 'Finishing…' : 'Changing files…'}
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
            Make these changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function targetLabel(row: WorkspaceEditPreviewRow): string {
  if (row.targetKind === 'dirty') return 'Open, has unsaved edits'
  if (row.targetKind === 'open') return 'Open, left unsaved'
  return 'Saved to disk'
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
  if (row.kind === 'create')
    return <FilePlusIcon className='text-success size-(--icon-size) shrink-0' />
  if (row.kind === 'delete')
    return <FileDashedIcon className='text-destructive size-(--icon-size) shrink-0' />
  if (row.kind === 'rename')
    return <FolderSimpleIcon className='text-info size-(--icon-size) shrink-0' />
  return <FileTextIcon className='text-foreground size-(--icon-size) shrink-0' />
}
