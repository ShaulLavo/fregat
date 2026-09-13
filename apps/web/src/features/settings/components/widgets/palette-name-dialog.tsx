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
import { useState } from 'react'

/** Asks for the name of a copy before the editor opens on it. */
export function PaletteNameDialog({
  initialName,
  onCancel,
  onSubmit,
  open,
  sourceName,
}: {
  readonly initialName: string
  readonly onCancel: () => void
  readonly onSubmit: (name: string) => void
  readonly open: boolean
  readonly sourceName: string
}) {
  return (
    <Dialog onOpenChange={(next) => next || onCancel()} open={open}>
      {open ? (
        <PaletteNameForm
          initialName={initialName}
          onCancel={onCancel}
          onSubmit={onSubmit}
          sourceName={sourceName}
        />
      ) : null}
    </Dialog>
  )
}

function PaletteNameForm({
  initialName,
  onCancel,
  onSubmit,
  sourceName,
}: {
  readonly initialName: string
  readonly onCancel: () => void
  readonly onSubmit: (name: string) => void
  readonly sourceName: string
}) {
  const [name, setName] = useState(initialName)
  const trimmed = name.trim()

  return (
    <DialogContent>
      <form
        className='contents'
        onSubmit={(event) => {
          event.preventDefault()
          if (trimmed !== '') onSubmit(trimmed)
        }}
      >
        <DialogHeader>
          <DialogTitle>Copy {sourceName}</DialogTitle>
          <DialogDescription>
            The copy is yours to edit; {sourceName} stays as it is.
          </DialogDescription>
        </DialogHeader>
        <Input
          aria-label='Palette name'
          autoFocus
          onChange={(event) => setName(event.target.value)}
          value={name}
        />
        <DialogFooter>
          <Button onClick={onCancel} type='button' variant='outline'>
            Cancel
          </Button>
          <Button disabled={trimmed === ''} type='submit'>
            Continue
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
