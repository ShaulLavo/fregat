import type { DocumentKey } from '@/lib/documents/utils/types'
import { WarningCircleIcon } from '@phosphor-icons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'
import { useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  useEditorWorkspaceState,
  useEditorWorkspaceStoreApi,
} from '@/features/editor/state/workspace-state'
import {
  isSettingsRead,
  settingsDiffAttachment,
  type SettingsComparisonPresentation,
} from '@/lib/diff-attachment'
import type { SettingsComparisonRequest, SnapshotComparisonLease } from '@/lib/snapshot-comparison'
import type { EditorTextBuffer } from '@singapore-editor/core/document'
import { settingsMutationKeys } from '@/features/settings/utils/mutation-keys'

import {
  useEditorDocumentState,
  useEditorDocumentStoreApi,
} from '@/features/editor/state/document-state'
import { toClientError } from '@/lib/client-error-taxonomy'

import { RawConflictReloadDialog } from '@/features/settings/components/raw-conflict-reload-dialog'
import { SettingsSyncService } from '@/features/settings/state/sync-service'

type ComparisonRequest = SettingsComparisonRequest & {
  readonly buffer: EditorTextBuffer
  readonly controller: AbortController
}
type ComparisonBinding = ComparisonRequest & { readonly lease: SnapshotComparisonLease }

export function RawConflictBanner({
  documentKey,
  onComparisonChange,
}: {
  readonly documentKey: DocumentKey
  readonly onComparisonChange?: (
    next: SettingsComparisonPresentation | null,
    previous: SettingsComparisonPresentation | null,
  ) => void
}) {
  const queryClient = useQueryClient()
  const documentStore = useEditorDocumentStoreApi()
  const document = useEditorDocumentState((state) => state.liveDocumentsByKey[documentKey])
  const environmentId = useEditorDocumentState((state) => state.environmentId)
  const rootPath = useEditorWorkspaceState((state) => state.rootFolder?.path ?? null)
  const workspaceStore = useEditorWorkspaceStoreApi()
  const request = useRef<ComparisonRequest | null>(null)
  const [binding, setBinding] = useState<ComparisonBinding | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)
  const acquisition = useMutation({
    mutationKey: settingsMutationKeys.comparisonView(documentKey),
    mutationFn: async (candidate: ComparisonRequest) => {
      const lease = documentStore.getState().acquireSettingsComparison(candidate)
      return { ...candidate, lease }
    },
  })
  const read = useEditorDocumentState((state) =>
    binding ? (state.snapshotComparisons.get(binding.lease) ?? null) : null,
  )
  const valid =
    document?.sync.kind === 'settings' &&
    document.sync.state === 'conflict' &&
    environmentId !== null &&
    rootPath !== null
  const bound =
    binding &&
    valid &&
    binding.key === documentKey &&
    binding.buffer === document.buffer &&
    binding.scope.environmentId === environmentId &&
    binding.scope.rootPath === rootPath
  if (compareOpen && (!valid || (binding && !bound))) {
    setCompareOpen(false)
    setBinding(null)
  }
  // This presentation is a layout-effect dependency and retains exact read/file identity.
  const presentation = useMemo<SettingsComparisonPresentation | null>(
    () =>
      read?.kind === 'ready' && isSettingsRead(read) && bound
        ? { read, attachment: settingsDiffAttachment(read) }
        : null,
    [read, bound],
  )
  const publish = useEffectEvent(
    (
      next: SettingsComparisonPresentation | null,
      previous: SettingsComparisonPresentation | null,
    ) => onComparisonChange?.(next, previous),
  )
  useLayoutEffect(() => {
    if (!presentation) return
    publish(presentation, null)
    return () => publish(null, presentation)
  }, [presentation])
  useLayoutEffect(
    () => () => {
      const current = request.current
      if (
        !current ||
        current.key !== documentKey ||
        current.buffer !== document?.buffer ||
        current.scope.environmentId !== environmentId ||
        current.scope.rootPath !== rootPath
      )
        return
      request.current = null
      current.controller.abort()
    },
    [documentKey, document?.buffer, environmentId, rootPath, valid],
  )

  function closeComparison() {
    const current = request.current
    request.current = null
    current?.controller.abort()
    setBinding(null)
    setCompareOpen(false)
  }
  function compare() {
    if (compareOpen) {
      closeComparison()
      return
    }
    if (!valid) return
    const controller = new AbortController()
    const candidate = {
      key: documentKey,
      buffer: document.buffer,
      scope: { environmentId, rootPath },
      controller,
      signal: controller.signal,
    }
    request.current = candidate
    setCompareOpen(true)
    acquisition.mutate(candidate, {
      onSuccess: (next) => {
        const state = documentStore.getState()
        const current = state.getLiveEditorDocument(documentKey)
        if (
          request.current !== candidate ||
          controller.signal.aborted ||
          state.environmentId !== candidate.scope.environmentId ||
          workspaceStore.getState().rootFolder?.path !== candidate.scope.rootPath ||
          current?.buffer !== candidate.buffer ||
          next.lease.read().kind !== 'ready'
        ) {
          next.lease.release()
          return
        }
        setBinding(next)
      },
      onError: (cause) => {
        if (request.current !== candidate) return
        closeComparison()
        setError(toClientError(cause).message)
      },
    })
  }
  const [reloadOpen, setReloadOpen] = useState(false)
  const [overwriting, setOverwriting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (document?.sync.kind !== 'settings' || document.sync.state !== 'conflict') return null

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
    }
    setOverwriting(false)
  }

  function reload() {
    documentStore.getState().reloadSettingsDocument(documentKey)
    setReloadOpen(false)
  }

  return (
    <div className='bg-warning/10 m-(--density-section-padding) flex shrink-0 flex-col gap-(--density-control-gap) rounded-lg p-(--density-section-padding)'>
      <div className='flex items-start gap-2'>
        <WarningCircleIcon
          className='text-warning mt-0.5 size-(--icon-size) shrink-0'
          weight='fill'
        />
        <div className='min-w-0 flex-1'>
          <p className='text-foreground text-sm font-medium'>
            settings.json changed somewhere else
          </p>
          <p className='text-muted-foreground text-xs'>
            Something else changed your settings while you had unsaved edits here. Keep yours to
            save over it, or use the latest version and drop yours.
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
          Use the latest version
        </Button>
        <Button
          disabled={!compareOpen && (awaitingConfirmed || !valid)}
          onClick={compare}
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
          Keep my changes
        </Button>
      </div>
      {awaitingConfirmed ? (
        <p className='text-warning text-xs'>Loading the latest version…</p>
      ) : null}
      {error ? <p className='text-destructive text-xs'>{error}</p> : null}
      <RawConflictReloadDialog
        onCancel={() => setReloadOpen(false)}
        onConfirm={reload}
        open={reloadOpen}
      />
    </div>
  )
}
