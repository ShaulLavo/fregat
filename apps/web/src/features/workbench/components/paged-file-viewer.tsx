import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { PAGED_PROOF_OPTIONS } from '@singapore-editor/paged'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { PaneBar } from '@workspace/ui/components/pane-bar'
import { Spinner } from '@workspace/ui/components/spinner'
import { ToolPane } from '@workspace/ui/patterns/tool-pane'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { toast } from 'sonner'
import { copyTextMutationOptions } from '@/lib/clipboard'
import { formatSize } from '@/lib/path-formatters'
import { usePagedFile } from '@/features/workbench/hooks/use-paged-file'
import { pagedErrorMessage } from '@/features/workbench/utils/paged-error-message'
import { PagedFileRows } from '@/features/workbench/components/paged-file-rows'

export function PagedFileViewer({ path }: { path: string }) {
  const [line, setLine] = useState(0)
  const [draftLine, setDraftLine] = useState('1')
  const [generation, setGeneration] = useState(0)
  const { resource, index, page } = usePagedFile(path, line, generation)
  const copy = useMutation({
    ...copyTextMutationOptions(),
    gcTime: 0,
    onSuccess: () => toast.success('Copied displayed text'),
  })
  const shown = page.data
  const error = page.error ?? resource.error ?? index.error
  const busy = resource.isPending || page.isFetching
  const requested = Number(draftLine)
  const validLine =
    Number.isSafeInteger(requested) &&
    requested > 0 &&
    (!index.data || requested <= index.data.lines)
  const lastRow = shown?.rows.at(-1)
  const nextLine = lastRow ? lastRow.line + 1 : 0

  function navigate(next: number) {
    setLine(next)
    setDraftLine(String(next + 1))
  }

  function reopen() {
    navigate(0)
    setGeneration((value) => value + 1)
  }

  return (
    <ToolPane
      aria-label='Paged read-only viewer'
      title='Read-only'
      detail={
        <span className='text-2xs font-mono tabular-nums'>
          UTF-8
          {shown
            ? ` · ${formatSize(shown.byteLength)} · Lines ${shown.firstLine + 1}–${lastRow ? lastRow.line + 1 : shown.firstLine + 1}`
            : ''}
        </span>
      }
      actions={
        <>
          {busy ? <Spinner size='sm' label='Loading file section' /> : null}
          <Button
            size='sm'
            variant='ghost'
            disabled={!shown || busy || Boolean(error) || copy.isPending}
            onClick={() =>
              shown &&
              copy.mutate({
                text: shown.rows.map((row) => row.text).join('\n'),
                label: 'displayed text',
              })
            }
          >
            Copy displayed text
          </Button>
        </>
      }
      subheader={
        <PaneBar>
          <Button
            size='sm'
            variant='ghost'
            disabled={!shown || shown.firstLine === 0 || busy || Boolean(error)}
            onClick={() =>
              navigate(Math.max(0, (shown?.firstLine ?? 0) - PAGED_PROOF_OPTIONS.maxWindowRows))
            }
          >
            Previous lines
          </Button>
          <Button
            size='sm'
            variant='ghost'
            disabled={
              !lastRow ||
              busy ||
              Boolean(error) ||
              (index.data !== undefined && nextLine >= index.data.lines)
            }
            onClick={() => navigate(nextLine)}
          >
            Next lines
          </Button>
          <form
            className='flex items-center gap-(--density-control-gap)'
            onSubmit={(event) => {
              event.preventDefault()
              if (validLine) navigate(requested - 1)
            }}
          >
            <Input
              aria-label='Line number'
              className='w-24 font-mono tabular-nums'
              type='number'
              min={1}
              value={draftLine}
              onChange={(event) => setDraftLine(event.target.value)}
            />
            <Button
              size='sm'
              variant='secondary'
              type='submit'
              disabled={!validLine || busy || Boolean(error)}
            >
              Go to line
            </Button>
          </form>
          {index.isFetching ? (
            <span className='text-muted-foreground text-2xs ml-auto flex items-center gap-(--density-control-gap)'>
              <Spinner size='xs' label='Indexing file lines' />
              Indexing lines…
            </span>
          ) : null}
        </PaneBar>
      }
      state={{ pending: !shown && !error, error: Boolean(error) }}
      errorState={
        <EmptyState
          title='Unable to read this section'
          description={pagedErrorMessage(error)}
          action={
            <Button size='sm' variant='secondary' onClick={reopen}>
              Reopen read-only
            </Button>
          }
          tone='error'
        />
      }
      bodyClassName='scroll-gutter'
    >
      {shown?.truncated ? (
        <p
          role='status'
          className='bg-info/10 text-foreground p-(--density-section-padding) text-xs'
        >
          This section reaches the display limit. The final line is shown in part. Copy displayed
          text includes the visible portion.
        </p>
      ) : null}
      {shown ? <PagedFileRows rows={shown.rows} /> : null}
    </ToolPane>
  )
}
