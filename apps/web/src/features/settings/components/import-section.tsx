import { Button } from '@workspace/ui/components/button'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { ImportSourceRow } from '@/features/settings/components/import-source-row'
import { useImportSources } from '@/features/settings/hooks/use-import-sources'

export function ImportSection() {
  const sources = useImportSources()

  return (
    <div className='border-border mb-3 flex flex-col gap-3 rounded-md border p-3'>
      <div className='space-y-1'>
        <h3 className='text-foreground text-sm font-medium'>Import existing chats</h3>
        <p className='text-muted-foreground text-xs'>
          Import conversation text for registered projects on the selected machine. Importing again
          also fills history in chats already listed here. Tool activity and attachments are not
          imported.
        </p>
        <p className='text-muted-foreground text-xs'>
          Claude Code reads local CLI history, not Claude app or web chats. Codex reads CLI and
          local app sessions stored in the same Codex home, not cloud-only sessions.
        </p>
      </div>
      {sources.isPending ? (
        <LoadingState className='space-y-2' label='Loading import sources'>
          <div aria-hidden='true' className='skeleton-sweep h-8 rounded-md' />
          <div aria-hidden='true' className='skeleton-sweep h-8 rounded-md' />
        </LoadingState>
      ) : null}
      {sources.isError ? (
        <EmptyState
          action={
            <Button onClick={() => void sources.refetch()} size='sm' variant='outline'>
              Retry
            </Button>
          }
          align='start'
          title='Import sources could not be loaded'
          tone='error'
        />
      ) : null}
      {sources.isSuccess && sources.data.length === 0 ? (
        <EmptyState
          align='start'
          title='No import sources available'
          description='Enable a Claude Code or Codex provider in Providers settings.'
        />
      ) : null}
      {sources.data?.map((source) => (
        <ImportSourceRow key={source.providerInstanceId} source={source} />
      ))}
    </div>
  )
}
