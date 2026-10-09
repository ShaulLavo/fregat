import { CheckCircleIcon, CircleIcon } from '@phosphor-icons/react'

/** Whether a file is among the ones to attach: a filled check when it is, an empty ring when not. */
export function ChoiceMark({ chosen }: { chosen: boolean }) {
  if (chosen)
    return (
      <CheckCircleIcon
        aria-hidden='true'
        className='text-primary size-(--icon-size) shrink-0'
        weight='fill'
      />
    )

  return (
    <CircleIcon aria-hidden='true' className='text-muted-foreground size-(--icon-size) shrink-0' />
  )
}
