import { useId, useState, type FormEvent } from 'react'
import type { MachineAuthPrompt } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { Spinner } from '@workspace/ui/components/spinner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { useAuth } from '@/features/environments/hooks/use-auth'

export function AuthForm({ prompt }: { readonly prompt: MachineAuthPrompt }) {
  const id = useId()
  const [secret, setSecret] = useState('')
  const { answer, pending, error } = useAuth()
  const confirmation = prompt.kind === 'confirmation'
  function submit(event: FormEvent) {
    event.preventDefault()
    const response = confirmation ? 'yes' : secret
    setSecret('')
    void answer(prompt, response)
  }
  function cancel() {
    setSecret('')
    void answer(prompt, null)
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) cancel()
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{confirmation ? 'Trust this SSH host?' : 'SSH authentication'}</DialogTitle>
          <DialogDescription>{prompt.name}</DialogDescription>
        </DialogHeader>
        <form className='flex flex-col gap-4' onSubmit={submit}>
          <label
            htmlFor={confirmation ? undefined : id}
            className='break-words whitespace-pre-wrap'
          >
            {prompt.prompt}
          </label>
          {!confirmation ? (
            <Input
              id={id}
              type='password'
              autoComplete='off'
              autoFocus
              value={secret}
              disabled={pending}
              onChange={(event) => setSecret(event.currentTarget.value)}
            />
          ) : null}
          {error ? (
            <p role='alert' className='text-destructive'>
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type='button' variant='ghost' onClick={cancel}>
              Cancel
            </Button>
            <Button type='submit' disabled={pending || (!confirmation && secret.length === 0)}>
              {pending ? <Spinner /> : null}
              {confirmation ? 'Trust and connect' : 'Continue'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
