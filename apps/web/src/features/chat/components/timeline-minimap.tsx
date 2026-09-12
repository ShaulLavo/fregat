import { cn } from '@workspace/ui/lib/utils'
import { useRef, useState, type KeyboardEvent } from 'react'

import {
  timelineMinimapKeyTargetIndex,
  timelineMinimapRovingMarkId,
  type TimelineMinimapBand,
  type TimelineMinimapMark,
} from '../utils/timeline-minimap'

/**
 * A thin rail of where the turns sit in the whole transcript, which one the
 * viewport is over, and a jump to any of them. Presentation only: the parent
 * owns the scroll container and decides what a selection does with it.
 */
export function TimelineMinimap({
  activeMarkId,
  band,
  marks,
  onSelect,
}: {
  activeMarkId: string | null
  band: TimelineMinimapBand | null
  marks: readonly TimelineMinimapMark[]
  onSelect: (mark: TimelineMinimapMark) => void
}) {
  const railRef = useRef<HTMLDivElement | null>(null)
  const [focusedMarkId, setFocusedMarkId] = useState<string | null>(null)
  const rovingMarkId = timelineMinimapRovingMarkId({ activeMarkId, focusedMarkId, marks })

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    const from = marks.findIndex((mark) => mark.id === rovingMarkId)
    const target = timelineMinimapKeyTargetIndex({
      count: marks.length,
      from: Math.max(0, from),
      key: event.key,
    })
    if (target === null) return

    const next = marks[target]
    if (!next) return

    // Arrows own the rail: left alone they would scroll the transcript behind
    // it, which is the one thing a map of that transcript must not do.
    event.preventDefault()
    setFocusedMarkId(next.id)
    railRef.current?.querySelector<HTMLButtonElement>(`[data-turn="${target}"]`)?.focus()
  }

  // The rail is inert except for the marks themselves: it floats over the
  // transcript's right edge, and a solid strip there would swallow every wheel
  // and drag that lands on it.
  return (
    <nav
      aria-label='Turns'
      className='pointer-events-none absolute top-2 right-2 bottom-12 z-10 w-4 opacity-70 transition-opacity focus-within:opacity-100 hover:opacity-100'
      onKeyDown={handleKeyDown}
    >
      <div className='relative h-full w-full' ref={railRef}>
        {band === null ? null : (
          <div
            aria-hidden='true'
            className='bg-muted-foreground/15 absolute right-0 w-full rounded-full'
            style={{
              height: `${(band.endFraction - band.startFraction) * 100}%`,
              top: `${band.startFraction * 100}%`,
            }}
          />
        )}
        {marks.map((mark, index) => (
          // Raw button: Button's ghost hover would paint a block over the transcript,
          // and its active translate would fight this mark's own -translate-y-1/2.
          <button
            aria-current={mark.id === activeMarkId ? 'true' : undefined}
            aria-label={`Jump to turn ${mark.ordinal} of ${marks.length}`}
            className='focus-ring pointer-events-auto absolute right-0 flex h-3 w-full -translate-y-1/2 items-center justify-end focus-visible:outline-none'
            data-turn={index}
            key={mark.id}
            style={{ top: `${mark.startFraction * 100}%` }}
            tabIndex={mark.id === rovingMarkId ? 0 : -1}
            type='button'
            onClick={() => onSelect(mark)}
            onFocus={() => setFocusedMarkId(mark.id)}
          >
            <span
              className={cn(
                'bg-muted-foreground/50 h-px w-2 rounded-full transition-[width,height,background-color]',
                mark.id === activeMarkId && 'bg-foreground h-0.5 w-full',
              )}
            />
          </button>
        ))}
      </div>
    </nav>
  )
}
