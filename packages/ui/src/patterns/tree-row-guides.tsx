import { cn } from '@workspace/ui/lib/utils'

// Six guide tones cycle by level; each lights while the pointer is over the `group/tree` ancestor.
const GUIDE_TONES = [
  'group-hover/tree:bg-(--tree-guide-1)',
  'group-hover/tree:bg-(--tree-guide-2)',
  'group-hover/tree:bg-(--tree-guide-3)',
  'group-hover/tree:bg-(--tree-guide-4)',
  'group-hover/tree:bg-(--tree-guide-5)',
  'group-hover/tree:bg-(--tree-guide-6)',
] as const

/** One `w-px` guide per level, placed on the lead's lane centres; `activeGuide` stays lit. */
export function TreeRowGuides({ depth, activeGuide }: { depth: number; activeGuide?: number }) {
  return Array.from({ length: depth }, (_, level) => (
    <span
      key={level}
      aria-hidden='true'
      data-slot='tree-row-guide'
      className={cn(
        'pointer-events-none absolute inset-y-0 w-px -translate-x-(--tree-guide-shift) bg-(--tree-guide) transition-opacity motion-reduce:transition-none',
        GUIDE_TONES[level % GUIDE_TONES.length],
        level === activeGuide
          ? 'opacity-(--tree-guide-active-opacity)'
          : 'opacity-(--tree-guide-opacity) group-hover/tree:opacity-(--tree-guide-hover-opacity)',
      )}
      style={{ left: `calc(var(--tree-guide-offset) + ${level} * var(--tree-indent))` }}
    />
  ))
}
