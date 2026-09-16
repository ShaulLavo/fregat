import { historyEdgePath, type HistoryRow } from '@/features/git/utils/history-layout'
import { historyLaneColors } from '@/lib/history-lane-colors'

export function HistoryGraph({
  row,
  width,
  head,
}: {
  row: HistoryRow
  width: number
  head: boolean
}) {
  const color = historyLaneColors[row.color % historyLaneColors.length]
  return (
    <svg aria-hidden='true' className='h-full shrink-0' width={width}>
      <svg width='100%' height='100%' viewBox={`0 0 ${width} 24`} preserveAspectRatio='none'>
        {row.edges.map((edge, index) => (
          <path
            key={index}
            className={historyLaneColors[edge.color % historyLaneColors.length]}
            d={historyEdgePath(edge)}
            fill='none'
            stroke='currentColor'
            strokeWidth='1.5'
          />
        ))}
      </svg>
      <circle
        className={color}
        cx={12 + row.column * 14}
        cy='50%'
        r={head ? 5 : 3.5}
        fill='currentColor'
      />
      {head ? (
        <circle
          className='text-background'
          cx={12 + row.column * 14}
          cy='50%'
          r='2'
          fill='currentColor'
        />
      ) : null}
    </svg>
  )
}
