import type { ProviderAccountUsage } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { Spinner } from '@workspace/ui/components/spinner'
import { useState } from 'react'
import { errorMessage } from '@/lib/error-message'
import { useResetCredit } from '@/features/chat/hooks/use-reset-credit'
import { resetCreditMessage } from '@/features/chat/utils/reset-credit-message'

export function ResetCreditAction({ account }: { account: ProviderAccountUsage }) {
  const [confirmation, setConfirmation] = useState<ProviderAccountUsage | null>(null)
  const mutation = useResetCredit(account)
  const available = account.resetCredits?.creditId ? account.resetCredits.available : 0
  if (available === 0 && !account.resetPending && !mutation.data && !mutation.error) return null
  return (
    <div className='mt-2 flex flex-col gap-2'>
      <Button
        onClick={() => setConfirmation(account)}
        disabled={mutation.isPending || (available === 0 && !account.resetPending)}
        size='sm'
        variant='secondary'
      >
        {mutation.isPending ? <Spinner /> : null}
        {account.resetPending ? 'Check reset attempt…' : 'Use reset credit…'}
      </Button>
      {mutation.error ? (
        <p role='alert' className='text-destructive text-xs'>
          {errorMessage(mutation.error, 'The reset could not be confirmed.')}
        </p>
      ) : null}
      {mutation.data ? (
        <p role='status' className='text-muted-foreground text-xs'>
          {resetCreditMessage(mutation.data)}
        </p>
      ) : null}
      <Dialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {account.resetPending ? 'Check the previous reset?' : 'Use one reset credit?'}
            </DialogTitle>
            <DialogDescription>
              {account.resetPending
                ? 'This retries the same reset attempt.'
                : 'This spends one credit from this Codex account to reset eligible usage limits. Instances sharing this account share the reset.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setConfirmation(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (confirmation) mutation.mutate(confirmation)
                setConfirmation(null)
              }}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
