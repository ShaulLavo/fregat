import type { DocumentKey } from '@/lib/documents/utils/types'
import { WarningCircleIcon } from '@phosphor-icons/react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'
import { useState } from 'react'

import {
  useEditorDocumentState,
  useEditorDocumentStoreApi,
} from '@/features/editor/state/document-state'
import { toClientError } from '@/lib/client-error-taxonomy'

import { RawConflictReloadDialog } from '@/features/settings/components/raw-conflict-reload-dialog'
import { SettingsSyncService } from '@/features/settings/state/sync-service'

export function RawConflictBanner({ documentKey }: { readonly documentKey: DocumentKey }) {
  const queryClient = useQueryClient()
  const documentStore = useEditorDocumentStoreApi()
  const document = useEditorDocumentState((state) => state.liveDocumentsByKey[documentKey])
  const [compareOpen, setCompareOpen] = useState(false)
  const [reloadOpen, setReloadOpen] = useState(false)
  const [overwriting, setOverwriting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (document?.sync.kind !== 'settings' || document.sync.state !== 'conflict') return null

  const localText = document.buffer.materializeFullText()
  const confirmedText = document.sync.confirmedText
  const awaitingConfirmed = document.sync.revision === null || confirmedText === null

  async function overwrite() {
    const current = documentStore.getState().getLiveEditorDocument(documentKey)
    if (!current || current.sync.kind !== 'settings' || current.sync.state !== 'conflict') return

    setError(null)
    setOverwriting(true)
    try {
      await new SettingsSyncService(documentStore, queryClient).overwrite(current)
    } catch (cause) {
      setError(toClientError(cause).message)
    } finally {
      setOverwriting(false)
    }
  }

  function reload() {
    documentStore.getState().reloadSettingsDocument(documentKey)
    setReloadOpen(false)
  }

  return (
    <div className='border-warning/30 bg-warning/10 m-(--density-section-padding) flex shrink-0 flex-col gap-(--density-control-gap) rounded-lg border p-(--density-section-padding)'>
      <div className='flex items-start gap-2'>
        <WarningCircleIcon
          className='text-warning mt-0.5 size-(--icon-size) shrink-0'
          weight='fill'
        />
        <div className='min-w-0 flex-1'>
          <p className='text-foreground text-sm font-medium'>settings.json changed elsewhere</p>
          <p className='text-muted-foreground text-xs'>
            Your local text is still intact. Reload it, compare both versions, or overwrite the
            latest confirmed file.
          </p>
        </div>
      </div>
      <div className='flex flex-wrap gap-2'>
        <Button
          disabled={awaitingConfirmed}
          onClick={() => setReloadOpen(true)}
          size='sm'
          variant='outline'
        >
          Reload
        </Button>
        <Button
          disabled={awaitingConfirmed}
          onClick={() => setCompareOpen((open) => !open)}
          size='sm'
          variant='outline'
        >
          {compareOpen ? 'Hide compare' : 'Compare'}
        </Button>
        <Button
          disabled={overwriting || awaitingConfirmed}
          onClick={() => void overwrite()}
          size='sm'
          variant='destructive'
        >
          {overwriting ? (
            <Spinner aria-hidden='true' data-icon='inline-start' role='presentation' />
          ) : null}
          Overwrite
        </Button>
      </div>
      {awaitingConfirmed ? (
        <p className='text-warning text-xs'>Waiting for the latest confirmed file…</p>
      ) : null}
      {error ? <p className='text-destructive text-xs'>{error}</p> : null}
      {compareOpen ? (
        <div className='grid gap-2 lg:grid-cols-2'>
          <div className='min-w-0'>
            <p className='text-muted-foreground mb-1 text-xs font-medium'>Local edits</p>
            <pre className='bg-background-solid max-h-48 overflow-auto rounded-lg border p-2 text-xs whitespace-pre-wrap'>
              {localText}
            </pre>
          </div>
          <div className='min-w-0'>
            <p className='text-muted-foreground mb-1 text-xs font-medium'>Confirmed file</p>
            <pre className='bg-background-solid max-h-48 overflow-auto rounded-lg border p-2 text-xs whitespace-pre-wrap'>
              {confirmedText ?? ''}
            </pre>
          </div>
        </div>
      ) : null}
      <RawConflictReloadDialog
        onCancel={() => setReloadOpen(false)}
        onConfirm={reload}
        open={reloadOpen}
      />
    </div>
  )
}
