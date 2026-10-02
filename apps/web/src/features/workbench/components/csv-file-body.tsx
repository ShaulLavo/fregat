import { useEffect, type ReactNode } from 'react'
import type { EditorTextBuffer, EditorViewSession } from '@singapore-editor/core/document'
import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'
import { ToolPane } from '@workspace/ui/patterns/tool-pane'
import { useCsvPresentation } from '@/features/workbench/state/csv-presentation'
import {
  loadCsvPresentationMutationOptions,
  type CsvPresentationModule,
} from '@/features/workbench/utils/csv-presentation-loader'
import { csvPresentationQueryKeys } from '@/features/workbench/utils/query-keys'
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
  const setMode = useCsvPresentation((state) => state.setMode)
  const client = useQueryClient()
  const load = useMutation(loadCsvPresentationMutationOptions(client))
  const presentation = useQuery<CsvPresentationModule>({
    queryKey: csvPresentationQueryKeys.presentation(),
    queryFn: skipToken,
    staleTime: Infinity,
    retry: false,
  })
  const requested = mode === 'table'
  const { mutate, status } = load
  useEffect(() => {
    if (requested && status === 'idle') mutate()
  }, [requested, status, mutate])
  const ready = requested && !readFailed && load.data && presentation.data && buffer && view
  const waiting = requested && !readFailed && !load.isError && (!load.data || !buffer || !view)

  let content = children
  if (ready) {
    const Table = presentation.data.Table
    content = (
      <Table
        buffer={buffer}
        view={view}
        editable={editable}
        engine={load.data.engine}
        tabId={tabId}
      />
    )
  }
  const Actions = presentation.data?.Actions
  const failed = requested && !readFailed && load.isError

  function prefetch() {
    if (!load.data && !load.isPending) load.mutate()
  }

  return (
    <ToolPane
      title='CSV'
      className='h-full'
      scroll={false}
      detail={
        <>
          {waiting ? <Spinner size='xs' label='Preparing CSV table' /> : null}
          {failed ? (
            <span role='status'>
              {presentation.data ? 'CSV engine could not load' : 'CSV table could not load'}
            </span>
          ) : null}
        </>
      }
      actions={
        <>
          {failed ? (
            <Button variant='ghost' size='sm' onClick={() => window.location.reload()}>
              Reload app
            </Button>
          ) : null}
          {ready && Actions ? (
            <Actions buffer={buffer} view={view} editable={editable} tabId={tabId} />
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
            onPointerEnter={prefetch}
            onFocus={prefetch}
            onClick={() => {
              setMode(tabId, 'table')
              prefetch()
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
