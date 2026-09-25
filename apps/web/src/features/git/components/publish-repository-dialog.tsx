import type { GitForgeKind, GitRepositoryVisibility } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { Input } from '@workspace/ui/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select'
import { Spinner } from '@workspace/ui/components/spinner'
import { useId, useState } from 'react'

import { InlineError } from '@/components/inline-error'
import { DialogField } from '@/features/git/components/dialog-field'
import { usePublishRepositoryMutation } from '@/features/git/hooks/use-publish-repository-mutation'
import { FORGE_OPTIONS, forgeOption } from '@/features/git/utils/publish-form'
import { errorMessage } from '@/lib/file-server'

/** Creates the repository on a forge and pushes this checkout to it. */
export function PublishRepositoryDialog({
  onOpenChange,
  open,
  rootPath,
}: {
  readonly onOpenChange: (open: boolean) => void
  readonly open: boolean
  readonly rootPath: string
}) {
  const id = useId()
  const publish = usePublishRepositoryMutation(rootPath)
  const [forge, setForge] = useState<GitForgeKind>('github')
  const [host, setHost] = useState('')
  const [repository, setRepository] = useState('')
  const [visibility, setVisibility] = useState<GitRepositoryVisibility>('private')
  const [protocol, setProtocol] = useState<'ssh' | 'https'>('ssh')
  const option = forgeOption(forge)
  const ready = repository.trim().length > 0 && !publish.isPending

  function submit() {
    publish.mutate(
      {
        forge,
        repository: repository.trim(),
        visibility,
        protocol,
        ...(host.trim() ? { host } : {}),
      },
      { onSuccess: () => onOpenChange(false) },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>Publish repository</DialogTitle>
          <DialogDescription>
            Create the repository on a forge, add it as a remote and push this branch.
          </DialogDescription>
        </DialogHeader>
        <form
          className='flex flex-col gap-3'
          onSubmit={(event) => {
            event.preventDefault()
            if (ready) submit()
          }}
        >
          <DialogField id={`${id}-forge`} label='Forge'>
            <Select value={forge} onValueChange={(next) => next && setForge(next as GitForgeKind)}>
              <SelectTrigger id={`${id}-forge`}>
                <SelectValue>{option.label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {FORGE_OPTIONS.map((entry) => (
                  <SelectItem key={entry.kind} value={entry.kind}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </DialogField>
          <DialogField id={`${id}-repository`} label='Repository'>
            <Input
              id={`${id}-repository`}
              autoCapitalize='off'
              autoComplete='off'
              autoCorrect='off'
              placeholder={option.example}
              spellCheck={false}
              value={repository}
              onChange={(event) => setRepository(event.currentTarget.value)}
            />
          </DialogField>
          <DialogField id={`${id}-host`} label='Host'>
            <Input
              id={`${id}-host`}
              autoCapitalize='off'
              autoComplete='off'
              placeholder={option.host}
              spellCheck={false}
              value={host}
              onChange={(event) => setHost(event.currentTarget.value)}
            />
          </DialogField>
          <div className='grid grid-cols-2 gap-3'>
            <DialogField id={`${id}-visibility`} label='Visibility'>
              <Select
                value={visibility}
                onValueChange={(next) => next && setVisibility(next as GitRepositoryVisibility)}
              >
                <SelectTrigger id={`${id}-visibility`}>
                  <SelectValue>{visibility === 'private' ? 'Private' : 'Public'}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='private'>Private</SelectItem>
                  <SelectItem value='public'>Public</SelectItem>
                </SelectContent>
              </Select>
            </DialogField>
            <DialogField id={`${id}-protocol`} label='Remote address'>
              <Select
                value={protocol}
                onValueChange={(next) => next && setProtocol(next as 'ssh' | 'https')}
              >
                <SelectTrigger id={`${id}-protocol`}>
                  <SelectValue>{protocol === 'ssh' ? 'SSH' : 'HTTPS'}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='ssh'>SSH</SelectItem>
                  <SelectItem value='https'>HTTPS</SelectItem>
                </SelectContent>
              </Select>
            </DialogField>
          </div>
          {publish.error ? (
            <InlineError message={errorMessage(publish.error)} title='Publish repository' />
          ) : null}
          <DialogFooter>
            <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type='submit' disabled={!ready}>
              {publish.isPending ? <Spinner /> : null}
              Publish
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
