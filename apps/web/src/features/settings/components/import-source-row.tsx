import { errorStringField } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'
import { useImportSessions } from '@/features/settings/hooks/use-import-sessions'
import {
  importResultSummary,
  importSourceName,
  type ImportSource,
} from '@/features/settings/utils/session-import'

export function ImportSourceRow({ source }: { source: ImportSource }) {
  const mutation = useImportSessions(source.providerInstanceId)
  const name = importSourceName(source.driverKind)

  return (
    <div className='border-border flex flex-col gap-2 border-t py-3'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <span className='text-foreground text-sm'>{source.label}</span>
        <Button
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
          size='sm'
          variant='outline'
        >
          {mutation.isPending ? <Spinner aria-label={`Importing from ${name}`} /> : null}
          Import from {name}
        </Button>
      </div>
      {mutation.isError ? (
        <p className='text-destructive text-xs' role='alert'>
          {errorStringField(mutation.error, 'message') ?? 'Import failed. Try again.'}
        </p>
      ) : null}
      {mutation.isSuccess ? (
        <div className='text-muted-foreground space-y-1 text-xs' role='status'>
          <p className='tabular-nums'>{importResultSummary(mutation.data)}</p>
          {mutation.data.failures.map((failure, index) => (
            <p className='text-destructive' key={index}>
              {failure.error.message}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  )
}
