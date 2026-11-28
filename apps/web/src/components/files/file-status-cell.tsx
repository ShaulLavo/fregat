import { cn } from '@workspace/ui/lib/utils'

import type { StatusPresentation } from '@/lib/git-status-symbols'

/** The one-letter change mark at a file row's trailing edge: Git, turn and timeline rows alike. */
export function FileStatusCell({ status }: { readonly status: StatusPresentation }) {
  return (
    <span
      className={cn(
        'flex h-(--density-row-height) shrink-0 items-center justify-self-end pb-px text-xs font-semibold leading-none',
        status.className,
      )}
    >
      {status.label}
    </span>
  )
}
