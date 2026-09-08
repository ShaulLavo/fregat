import { useEffect, useRef, useState } from 'react'
import { useKeyboard, useTerminalDimensions } from '@opentui/react'
import type { ScrollBoxRenderable } from '@opentui/core'
import type { ChatSession } from '@workspace/client-core/chat/types'
import { usePaneFocus } from '@/commands/hooks/use-pane-focus'
import { useCommandHandlers } from '@/commands/hooks/use-command-handlers'
import { useCommands } from '@/commands/hooks/use-commands'
import { timelineRows, groupTimelineRows } from '@/agent-stage/utils/timeline'
import { createTimelineLayout } from '@/agent-stage/state/timeline-layout'
import { markdownSyntax } from '@/agent-stage/utils/syntax'
import { TimelineRow } from '@/agent-stage/components/timeline-row'
import { OrbitLoader } from '@/components/orbit-loader'
import type { Theme } from '@/theme/utils/theme'

export function Timeline({
  conversation,
  theme,
  enabled,
  loadingEarlier,
  hasEarlier,
  loadEarlier,
  busy,
}: {
  readonly conversation: ChatSession
  readonly theme: Theme
  readonly enabled: boolean
  readonly loadingEarlier: boolean
  readonly hasEarlier: boolean
  readonly loadEarlier: () => Promise<unknown>
  readonly busy: boolean
}) {
  const rows = timelineRows(conversation)
  const [endId, setEndId] = useState<string | null>(null)
  const [activityMode, setActivityMode] = useState<0 | 1 | 2>(0)
  const [layout] = useState(createTimelineLayout)
  const [syntax] = useState(() => markdownSyntax(theme))
  const scroll = useRef<ScrollBoxRenderable>(null)
  const dimensions = useTerminalDimensions()
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null)
  const commands = useCommands()
  const focused = usePaneFocus({ id: 'agent-timeline', area: 'chat', enabled })
  const visible =
    activityMode !== 0
      ? rows
      : rows.filter((row) => row.kind !== 'activity' || row.activity.tone === 'error')
  const width = viewport?.width ?? dimensions.width
  const height = viewport?.height ?? dimensions.height - 15
  const window = layout.window(visible, width, height, endId)
  useEffect(() => () => syntax.destroy(), [syntax])
  function latest() {
    setEndId(null)
    scroll.current?.scrollTo(scroll.current.scrollHeight)
  }
  async function earlier() {
    if (window.start > 0) {
      setEndId(visible[window.start - 1].id)
      return
    }
    if (!hasEarlier || loadingEarlier) return
    const first = visible[0]?.id ?? null
    await loadEarlier()
    setEndId(first)
  }
  function later() {
    setEndId(layout.next(visible, width, height, window.end))
    scroll.current?.scrollTo(0)
  }
  function toggleActivities() {
    setActivityMode((current) => {
      if (current === 0) return 1
      if (current === 1) return 2
      return 0
    })
  }
  useKeyboard((event) => {
    if (!focused || event.defaultPrevented || event.ctrl || event.meta) return
    if (event.name === 'pageup' && scroll.current?.scrollTop === 0) {
      event.preventDefault()
      void earlier()
      return
    }
    if (
      event.name === 'pagedown' &&
      scroll.current &&
      scroll.current.scrollTop + scroll.current.viewport.height >= scroll.current.scrollHeight
    ) {
      event.preventDefault()
      later()
    }
  })
  useCommandHandlers(
    {
      'chat.jumpToLatest': { run: latest },
      'chat.loadEarlier': { run: earlier },
      'chat.previousTimelinePage': { run: earlier },
      'chat.nextTimelinePage': { run: later },
      'chat.toggleActivities': { run: toggleActivities },
      'chat.focusTimeline': {
        run: () => {
          commands.focus.request({
            kind: 'match',
            matches: (item) => item.widgetId === 'agent-timeline',
          })
        },
      },
    },
    enabled,
  )
  const grouped = groupTimelineRows(window.rows)
  return (
    <box flexDirection='column' flexGrow={1} minHeight={0} minWidth={0}>
      <box height={1} flexShrink={0} gap={1} flexDirection='row'>
        <text
          fg={theme.info}
          onMouseDown={() => {
            if (enabled) void earlier()
          }}
        >
          ‹ Earlier
        </text>
        <text
          fg={theme.mutedForeground}
        >{`${visible.length ? window.start + 1 : 0}–${window.end}/${visible.length}`}</text>
        <text
          fg={theme.info}
          onMouseDown={() => {
            if (enabled) later()
          }}
        >
          Later ›
        </text>
        <text
          fg={theme.info}
          onMouseDown={() => {
            if (enabled) latest()
          }}
        >
          Latest
        </text>
        <text
          fg={theme.info}
          onMouseDown={() => {
            if (enabled) toggleActivities()
          }}
        >
          {['Show activity', 'Expand activity', 'Hide activity'][activityMode]}
        </text>
      </box>
      {loadingEarlier && (
        <box height={1} flexDirection='row'>
          <OrbitLoader theme={theme} />
          <text fg={theme.mutedForeground}> Loading earlier messages…</text>
        </box>
      )}
      <scrollbox
        onSizeChange={function () {
          const next = { width: this.viewport.width, height: this.viewport.height }
          setViewport((current) =>
            current?.width === next.width && current.height === next.height ? current : next,
          )
        }}
        id='agent-timeline'
        ref={scroll}
        focused={focused}
        flexGrow={1}
        minHeight={0}
        stickyScroll
        stickyStart='bottom'
        scrollX={false}
        contentOptions={{ flexDirection: 'column', gap: 1, paddingX: 1 }}
      >
        {grouped.map((row) => (
          <TimelineRow
            key={`${row.id}:${activityMode}`}
            row={row}
            theme={theme}
            syntax={syntax}
            expanded={activityMode !== 1}
          />
        ))}
        {busy && endId === null && (
          <box flexShrink={0} flexDirection='row'>
            <OrbitLoader theme={theme} />
            <text fg={theme.mutedForeground}> Working…</text>
          </box>
        )}
      </scrollbox>
    </box>
  )
}
