import type { PendingChordLabel } from '@singapor/core/keymap'
import { formatChord } from '@/keymap/utils/format-keys'

export function PendingChordIndicator({ pending }: { readonly pending: PendingChordLabel | null }) {
  return (
    <output aria-atomic='true' aria-live='polite'>
      {pending ? (
        <span className='bg-popover-solid border-border text-foreground pointer-events-none fixed bottom-4 left-4 z-50 flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-x-2 rounded-lg border px-3 py-2 text-xs shadow-md'>
          <kbd className='font-mono whitespace-nowrap'>{formatChord(pending.keys)}</kbd>
          <span>pressed. Waiting for the next key…</span>
          <span className='text-muted-foreground tabular-nums'>
            {pending.candidateCount} available
          </span>
        </span>
      ) : null}
    </output>
  )
}
