import { historyLaneColor } from '@/lib/history-lane-colors'
import type { BranchLaneRow } from '../utils/branch-lanes'

export function BranchLane({
  row,
  lanes,
  selected,
}: {
  readonly row: BranchLaneRow
  readonly lanes: number
  readonly selected: boolean
}) {
  const width = lanes * 12
  const x = row.lane * 12 + 6
  return (
    <svg
      aria-hidden='true'
      data-slot='branch-lane'
      data-parent={row.parent ?? undefined}
      viewBox={`0 0 ${width} 24`}
      preserveAspectRatio='none'
      className='absolute inset-y-0 left-2 size-auto h-full'
      style={{ width }}
    >
      {[...new Set([...row.above, ...row.below])].map((lane) => (
        <path
          key={lane}
          d={`M ${lane * 12 + 6} ${row.above.includes(lane) ? 0 : 12} V ${row.below.includes(lane) ? 24 : 12}`}
          fill='none'
          stroke='currentColor'
          className={`${historyLaneColor(lane)} opacity-40`}
        />
      ))}
      {row.parentLane !== null && row.parentLane !== row.lane ? (
        <path
          d={`M ${row.parentLane * 12 + 6} 0 Q ${row.parentLane * 12 + 6} 12 ${x} 12`}
          fill='none'
          stroke='currentColor'
          className={`${historyLaneColor(row.lane)} opacity-40`}
        />
      ) : null}
      <circle
        cx={x}
        cy='12'
        r={selected || row.branch.current ? 3.5 : 2}
        fill='currentColor'
        className={`${historyLaneColor(row.lane)} opacity-60`}
      />
      {selected || row.branch.current ? (
        <circle
          cx={x}
          cy='12'
          r='5'
          fill='none'
          stroke='currentColor'
          className={`${historyLaneColor(row.lane)} opacity-60`}
        />
      ) : null}
    </svg>
  )
}
