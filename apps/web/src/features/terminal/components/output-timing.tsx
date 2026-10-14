import type { TerminalOutputTiming } from 'ghostty-webgpu'

import { outputTimingParts } from '@/features/terminal/utils/output-timing'

/** How long the last output took to arrive, then to be drawn and shown. */
export function OutputTiming({ timing }: { readonly timing: TerminalOutputTiming }) {
  return (
    <dl
      aria-label='Last output timing'
      className='bg-muted text-muted-foreground text-2xs pointer-events-none absolute top-(--density-gap-tight) right-(--density-control-padding-x) flex gap-(--density-control-gap) rounded-md px-(--density-control-padding-x) font-mono tabular-nums'
      data-output-timing=''
    >
      {outputTimingParts(timing).map((part) => (
        <div key={part.label} className='flex gap-1'>
          <dt>{part.label}</dt>
          <dd className='text-foreground'>{part.value}</dd>
        </div>
      ))}
    </dl>
  )
}
