import { Alert, AlertTitle } from '@workspace/ui/components/alert'
import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'

import { useInitSubmodulesMutation } from '@/features/git/hooks/use-init-submodules-mutation'
import { useStatus } from '@/features/git/hooks/use-status'

/** Declared submodules with no checkout, which a new worktree can leave behind. */
export function SubmodulesNotice({ rootPath }: { readonly rootPath: string }) {
  const count = useStatus(rootPath).data?.uninitializedSubmodules ?? 0
  const initialize = useInitSubmodulesMutation(rootPath)
  if (count === 0) return null

  return (
    <Alert className='mx-(--bar-padding-x) mt-2 flex w-auto items-center gap-2' variant='warning'>
      <AlertTitle className='min-w-0 flex-1 tabular-nums'>
        {count === 1 ? '1 submodule is not initialized' : `${count} submodules are not initialized`}
      </AlertTitle>
      <Button
        disabled={initialize.isPending}
        onClick={() => initialize.mutate()}
        size='sm'
        variant='outline'
      >
        {initialize.isPending ? <Spinner /> : null}
        Initialize
      </Button>
    </Alert>
  )
}
