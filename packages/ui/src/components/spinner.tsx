import { cn } from '@workspace/ui/lib/utils'
import { SpinnerIcon } from '@phosphor-icons/react'

type SpinnerProps = Omit<React.ComponentProps<'svg'>, 'ref'>

/**
 * The one answer to "this control is busy" — a spinner belongs next to (or
 * inside) something that already exists. A region with no content yet gets
 * LoadingState instead.
 *
 * Reduced motion slows the spin rather than stopping it: a frozen spinner reads
 * as a hung process, which is the opposite of what it is there to say.
 */
function Spinner({ className, ...props }: SpinnerProps) {
  return (
    <SpinnerIcon
      role='status'
      aria-label='Loading'
      className={cn(
        'size-(--icon-size) animate-spin motion-reduce:[animation-duration:2s]',
        className,
      )}
      {...props}
    />
  )
}

export { Spinner }
