import type { Icon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'

/** One way to the first project: an icon, what it does, and the sentence that says where. */
export function PathChoice({
  detail,
  icon: Glyph,
  onSelect,
  title,
}: {
  readonly detail: string
  readonly icon: Icon
  readonly onSelect: () => void
  readonly title: string
}) {
  return (
    <Button
      className='h-auto items-start justify-start gap-3 p-3 text-left whitespace-normal'
      type='button'
      variant='outline'
      onClick={onSelect}
    >
      <span className='bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md'>
        <Glyph className='size-(--icon-size)' />
      </span>
      <span className='min-w-0'>
        <span className='text-foreground block text-sm font-medium'>{title}</span>
        <span className='text-muted-foreground mt-0.5 block text-xs leading-relaxed font-normal'>
          {detail}
        </span>
      </span>
    </Button>
  )
}
