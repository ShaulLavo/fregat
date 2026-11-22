import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
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
  const [draftByte, setDraftByte] = useState('0')
  const [generation, setGeneration] = useState(0)
  const { resource, page, navigate } = usePagedFile(path, generation)
  const copy = useMutation({
    ...copyTextMutationOptions(),
    gcTime: 0,
    onSuccess: () => toast.success('Copied displayed text'),
  })
  const shown = page.data?.kind === 'window' ? page.data : undefined
  const error = page.error ?? resource.error
  const busy = resource.isFetching || page.isFetching
  const requested = Number(draftByte)
  const byteLength = resource.data?.source.byteLength
  const validByte =
    draftByte.trim() !== '' &&
    Number.isSafeInteger(requested) &&
    requested >= 0 &&
    byteLength !== undefined &&
    requested <= byteLength
  const previous = shown?.previous
  const next = shown?.next
  const first = shown?.fragments[0]
  const last = shown?.fragments.at(-1)
  const location =
    first?.line !== undefined && last?.line !== undefined
      ? ` · Lines ${first.line + 1}–${last.line + 1}`
      : first
        ? ` · Byte ${first.start.byteOffset}`
        : ''

  function reopen() {
    setDraftByte('0')
    setGeneration((value) => value + 1)
  }

  return (
    <ToolPane
      aria-label='Paged read-only viewer'
      title='Read-only'
      detail={
        <span className='text-2xs font-mono tabular-nums'>
          UTF-8
          {shown ? ` · ${formatSize(shown.byteLength)}${location}` : ''}
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
                text: shown.fragments.map(({ text, lineBreak }) => text + lineBreak).join(''),
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
            disabled={!previous || busy || Boolean(error)}
            onClick={() => previous && navigate({ kind: 'previous', cursor: previous })}
          >
            Previous section
          </Button>
          <Button
            size='sm'
            variant='ghost'
            disabled={!next || busy || Boolean(error)}
            onClick={() => next && navigate({ kind: 'next', cursor: next })}
          >
            Next section
          </Button>
          <form
            className='flex items-center gap-(--density-control-gap)'
            onSubmit={(event) => {
              event.preventDefault()
              if (validByte) navigate({ kind: 'byte', offset: requested })
            }}
          >
            <Input
              aria-label='Byte offset'
              className='w-24 font-mono tabular-nums'
              type='number'
              min={0}
              max={byteLength}
              value={draftByte}
              onChange={(event) => setDraftByte(event.target.value)}
            />
            <Button
              size='sm'
              variant='secondary'
              type='submit'
              disabled={!validByte || busy || Boolean(error)}
            >
              Go to byte
            </Button>
          </form>
        </PaneBar>
      }
      state={{ pending: !page.data && !error, error: Boolean(error) }}
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
      {shown?.stop === 'text' || shown?.stop === 'budget' ? (
        <p
          role='status'
          className='bg-info/10 text-foreground p-(--density-section-padding) text-xs'
        >
          This section reached the read limit. Use the section controls to continue.
        </p>
      ) : null}
      {page.data?.kind === 'unavailable' ? (
        <p role='status' className='text-muted-foreground p-(--density-section-padding) text-xs'>
          No text is available at this byte offset.
        </p>
      ) : null}
      {shown ? <PagedFileRows fragments={shown.fragments} /> : null}
    </ToolPane>
  )
}
