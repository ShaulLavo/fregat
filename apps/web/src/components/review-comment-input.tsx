import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { useState } from 'react'

/** One line of review: Enter adds it to the draft, Escape drops it. */
export function ReviewCommentInput({
  onCancel,
  onSave,
}: {
  readonly onCancel: () => void
  readonly onSave: (body: string) => void
}) {
  const [body, setBody] = useState('')

  return (
    <form
      className='flex items-center gap-1'
      onSubmit={(event) => {
        event.preventDefault()
        onSave(body)
      }}
    >
      <Input
        aria-label='Review comment'
        autoFocus
        className='h-(--density-control-height-sm) w-72 text-xs'
        placeholder='Comment on these lines'
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          onCancel()
        }}
      />
      <Button disabled={!body.trim()} size='sm' type='submit' variant='ghost'>
        Add to review
      </Button>
    </form>
  )
}
