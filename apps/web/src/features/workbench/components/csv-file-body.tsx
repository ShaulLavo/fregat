import { useEffect, type ReactNode } from 'react'
import type { EditorTextBuffer, EditorViewSession } from '@singapore-editor/core/document'
import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { Spinner } from '@workspace/ui/components/spinner'
import { ToolPane } from '@workspace/ui/patterns/tool-pane'
import { CsvHistoryAction } from '@/features/workbench/components/csv-history-action'
import { CsvTable } from '@/features/workbench/components/csv-table'
import { useCsvPresentation } from '@/features/workbench/state/csv-presentation'
import { loadCsvEngineMutationOptions, type CsvEngine } from '@/features/workbench/utils/csv-engine'
import { csvEngineQueryKeys } from '@/features/workbench/utils/query-keys'
import type { TabId } from '@/lib/documents/utils/types'

export function CsvFileBody({
  buffer,
  view,
  editable,
  readFailed,
  tabId,
  children,
}: {
  readonly buffer: EditorTextBuffer | null
  readonly view: EditorViewSession | null
  readonly editable: boolean
  readonly readFailed: boolean
  readonly tabId: TabId
  readonly children: ReactNode
}) {
  const mode = useCsvPresentation((state) => state.tabs[tabId]?.mode ?? 'text')
  const header = useCsvPresentation((state) => state.tabs[tabId]?.header ?? false)
  const toggleHeader = useCsvPresentation((state) => state.toggleHeader)
  const setMode = useCsvPresentation((state) => state.setMode)
  const load = useMutation(loadCsvEngineMutationOptions(useQueryClient()))
  const engine = useQuery<CsvEngine>({
    queryKey: csvEngineQueryKeys.engine(),
    queryFn: skipToken,
    staleTime: Infinity,
    retry: false,
  })
  const requested = mode === 'table'
  const { mutate, status } = load
  useEffect(() => {
    if (requested && !engine.data && status === 'idle') mutate()
  }, [requested, engine.data, status, mutate])
  const ready = requested && !readFailed && engine.data && buffer && view
  const waiting =
    requested && !readFailed && !load.isError && (engine.isPending || !buffer || !view)

  let content = children
  if (ready)
    content = (
      <CsvTable
        buffer={buffer}
        view={view}
        editable={editable}
        engine={engine.data}
        tabId={tabId}
      />
    )
  if (requested && !readFailed && !engine.data && load.isError)
    content = (
      <EmptyState
        title='CSV engine could not load'
        description='Reload the app to load the CSV table again.'
        action={
          <Button variant='outline' size='sm' onClick={() => window.location.reload()}>
            Reload app
          </Button>
        }
      />
    )

  return (
    <ToolPane
      title='CSV'
      className='h-full'
      scroll={false}
      detail={waiting ? <Spinner size='xs' label='Preparing CSV table' /> : undefined}
      actions={
        <>
          {ready ? (
            <>
              <Button
                variant='ghost'
                size='sm'
                className='aria-pressed:bg-accent'
                aria-pressed={header}
                onClick={() => toggleHeader(tabId)}
              >
                First row is header
              </Button>
              <CsvHistoryAction buffer={buffer} view={view} editable={editable} action='undo' />
              <CsvHistoryAction buffer={buffer} view={view} editable={editable} action='redo' />
            </>
          ) : null}
          <Button
            variant='ghost'
            size='sm'
            className='aria-pressed:bg-accent'
            aria-pressed={!ready}
            onClick={() => setMode(tabId, 'text')}
          >
            Text
          </Button>
          <Button
            variant='ghost'
            size='sm'
            className='aria-pressed:bg-accent'
            aria-pressed={Boolean(ready)}
            onPointerEnter={() => {
              if (!engine.data && !load.isPending) load.mutate()
            }}
            onFocus={() => {
              if (!engine.data && !load.isPending) load.mutate()
            }}
            onClick={() => {
              setMode(tabId, 'table')
              if (!engine.data) load.mutate()
            }}
          >
            Table
          </Button>
        </>
      }
      bodyClassName='flex flex-col'
    >
      {content}
    </ToolPane>
  )
}
