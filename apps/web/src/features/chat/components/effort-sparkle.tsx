import { cn } from '@workspace/ui/lib/utils'

import { sparkleCells, type EffortSparkleLevel } from '@/features/chat/utils/effort-sparkle'

/**
 * A setting that is on, never a wait: cells twinkle in opacity only, on the compositor.
 * Its parent must be positioned.
 */
export function EffortSparkle({ level }: { level: EffortSparkleLevel | null }) {
  if (!level) return null

  return (
    <span
      aria-hidden='true'
      className={cn(
        'pointer-events-none absolute inset-0 overflow-hidden rounded-md',
        level === 'max'
          ? '[--effort-sparkle-duration:var(--effort-sparkle-duration-max)]'
          : '[--effort-sparkle-duration:var(--effort-sparkle-duration-xhigh)]',
      )}
      data-effort-sparkle={level}
    >
      {sparkleCells(level).map((cell, index) => (
        <span
          className='effort-sparkle-cell bg-primary absolute size-[3px]'
          // Cells never reorder, so the index is the cell.
          key={index}
          style={{
            animationDelay: `calc(var(--effort-sparkle-duration) * ${-cell.delay})`,
            left: `${cell.left}%`,
            top: `${cell.top}%`,
          }}
        />
      ))}
    </span>
  )
}
