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
      {available > 0 || account.resetPending ? (
        <Button
          onClick={() => setConfirmation(account)}
          disabled={mutation.isPending}
          size='sm'
          variant='secondary'
        >
          {mutation.isPending ? <Spinner /> : null}
          {account.resetPending ? 'Check last reset…' : 'Use reset credit…'}
        </Button>
      ) : null}
      {mutation.error ? (
        <p role='alert' className='text-destructive text-xs'>
          {errorMessage(mutation.error, 'Could not tell whether the reset worked.')}
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
              {account.resetPending ? 'Check your last reset?' : 'Use one reset credit?'}
            </DialogTitle>
            <DialogDescription>
              {account.resetPending
                ? 'Sends your last reset request again to see whether it went through.'
                : 'Spends one credit from this Codex account to reset its usage limits. Everything signed in to this account gets the reset.'}
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
              {account.resetPending ? 'Check again' : 'Use 1 credit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
