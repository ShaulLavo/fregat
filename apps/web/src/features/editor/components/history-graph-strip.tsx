import { historyStateLabel } from '@/features/editor/utils/history-state-label'
import { historyLaneColor } from '@/lib/history-lane-colors'
import {
  layoutHistoryGraph,
  type EditorHistoryGraph,
  type HistoryNodeId,
} from '@singapore-editor/core'
import { useId, type KeyboardEvent } from 'react'

const COLUMN_WIDTH = 14
const LANE_HEIGHT = 24
const EDGE_PADDING = 12

export function HistoryGraphStrip({
  graph,
  focusedId,
  selectedIds,
  now,
  onFocus,
  onKeyDown,
  onToggleSelect,
}: {
  graph: EditorHistoryGraph
  focusedId: HistoryNodeId | null
  selectedIds: readonly HistoryNodeId[]
  now: number
  onFocus: (id: HistoryNodeId) => void
  onKeyDown: (event: KeyboardEvent<SVGSVGElement>) => void
  onToggleSelect: (id: HistoryNodeId) => void
}) {
  // Two panes over two files must not share option ids.
  const idPrefix = useId()
  const layout = layoutHistoryGraph(graph)
  // A barrier sits one column before the root: the states behind a workspace edit.
  const offset = graph.barrier ? 1 : 0
  const width = EDGE_PADDING * 2 + (layout.columns + offset) * COLUMN_WIDTH
  const height = Math.max(1, layout.lanes) * LANE_HEIGHT
  const positions = new Map(
    layout.nodes.map((node) => [
      node.id,
      {
        x: EDGE_PADDING + (node.column + offset) * COLUMN_WIDTH,
        y: node.lane * LANE_HEIGHT + LANE_HEIGHT / 2,
        lane: node.lane,
      },
    ]),
  )
  const focusedDom = focusedId === null ? undefined : nodeDomId(idPrefix, focusedId)

  return (
    <svg
      aria-activedescendant={focusedDom}
      aria-label='History states'
      className='focus-ring-inset block shrink-0 outline-none'
      height={height}
      role='listbox'
      tabIndex={0}
      width={width}
      onKeyDown={onKeyDown}
    >
      {graph.barrier ? (
        <circle
          className='text-muted-foreground'
          cx={EDGE_PADDING}
          cy={LANE_HEIGHT / 2}
          fill='none'
          r={3.5}
          stroke='currentColor'
          strokeWidth='1.5'
        >
          <title>{`Earlier history is behind workspace edit ${graph.barrier.groupId}`}</title>
        </circle>
      ) : null}
      {graph.barrier && positions.size > 0 ? (
        <path
          className='text-muted-foreground'
          d={`M ${EDGE_PADDING + 3.5} ${LANE_HEIGHT / 2} L ${EDGE_PADDING + COLUMN_WIDTH - 5} ${LANE_HEIGHT / 2}`}
          stroke='currentColor'
          strokeDasharray='2 2'
          strokeWidth='1.5'
        />
      ) : null}
      {layout.edges.map((edge) => {
        const from = positions.get(edge.fromId)
        const to = positions.get(edge.toId)
        if (!from || !to) return null
        const middle = (from.x + to.x) / 2
        return (
          <path
            className={historyLaneColor(to.lane)}
            d={`M ${from.x} ${from.y} C ${middle} ${from.y}, ${middle} ${to.y}, ${to.x} ${to.y}`}
            fill='none'
            key={`${edge.fromId}-${edge.toId}`}
            stroke='currentColor'
            strokeWidth='1.5'
          />
        )
      })}
      {graph.nodes.map((node) => {
        const at = positions.get(node.id)
        if (!at) return null
        const selected = selectedIds.includes(node.id)
        const focused = node.id === focusedId
        return (
          <g
            aria-label={historyStateLabel(node, now)}
            aria-selected={selected}
            className='cursor-pointer'
            id={nodeDomId(idPrefix, node.id)}
            key={node.id}
            role='option'
            onClick={(event) => {
              if (event.shiftKey) onToggleSelect(node.id)
              else onFocus(node.id)
            }}
          >
            <title>{historyStateLabel(node, now)}</title>
            {focused || selected ? (
              <circle
                className={selected ? 'text-info' : 'text-foreground'}
                cx={at.x}
                cy={at.y}
                fill='none'
                r={6.5}
                stroke='currentColor'
                strokeWidth='1.5'
              />
            ) : null}
            <circle
              className={historyLaneColor(at.lane)}
              cx={at.x}
              cy={at.y}
              fill='currentColor'
              r={node.isCurrent ? 5 : 3.5}
            />
            {node.isCurrent ? (
              <circle className='text-background' cx={at.x} cy={at.y} fill='currentColor' r={2} />
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}

function nodeDomId(prefix: string, id: HistoryNodeId): string {
  return `${prefix}history-state-${id}`
}
