import { ArrowsLeftRightIcon } from '@phosphor-icons/react'

/**
 * One line of chrome above a diff that has no changes in it — a pure rename, a mode change, two
 * sides that happen to match. The file itself is still drawn below; this only answers the question
 * the empty diff raises, which nothing in the rows can.
 */
export function UnchangedDiffBanner({ message }: { message: string }) {
  return (
    <div
      className='text-muted-foreground border-border flex shrink-0 items-center gap-(--density-control-gap) border-b px-(--density-control-padding-x) py-(--density-control-gap) text-xs'
      role='status'
    >
      <ArrowsLeftRightIcon aria-hidden='true' className='size-(--icon-size-sm) shrink-0' />
      <span className='truncate'>{message}</span>
    </div>
  )
}
