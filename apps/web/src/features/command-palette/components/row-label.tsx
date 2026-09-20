import { cn } from '@workspace/ui/lib/utils'
import type { ReactNode } from 'react'

/**
 * One palette row's text: label first, muted description filling the rest of the
 * same line. Single-line is the whole point — VS Code's quick pick puts every
 * item on one row, and stacking the description halves how many choices fit in
 * the same list height. Renders as siblings so it drops straight into
 * `CommandItem`'s flex row.
 */
export function RowLabel({
  badge,
  description,
  descriptionClassName,
  label,
}: {
  /** A chip that sits between the label and the description. */
  readonly badge?: ReactNode
  readonly description?: ReactNode
  readonly descriptionClassName?: string
  readonly label: string
}) {
  return (
    <>
      <span className='max-w-[55%] shrink-0 truncate font-medium'>{label}</span>
      {badge}
      {description ? (
        <span
          className={cn(
            'text-muted-foreground min-w-0 flex-1 truncate text-2xs',
            descriptionClassName,
          )}
        >
          {description}
        </span>
      ) : (
        <span className='min-w-0 flex-1' />
      )}
    </>
  )
}
