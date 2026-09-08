import { useState } from 'react'
import type { OrchestrationSessionActivity } from '@workspace/contracts'
import { activityText } from '@/agent-stage/utils/timeline'
import type { Theme } from '@/theme/utils/theme'

export function ActivityGroup({
  activities,
  theme,
  expanded: initiallyExpanded,
}: {
  readonly activities: readonly OrchestrationSessionActivity[]
  readonly theme: Theme
  readonly expanded: boolean
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded)
  const last = activities.at(-1)
  if (!last) return null
  return (
    <box flexDirection='column' flexShrink={0}>
      <text
        fg={theme.mutedForeground}
        onMouseDown={() => setExpanded(!expanded)}
      >{`${expanded ? '▾' : '▸'} ${activities.length} activities · ${activityText(last)}`}</text>
      {expanded &&
        activities.map((activity) => (
          <text
            key={activity.id}
            fg={activity.tone === 'error' ? theme.destructive : theme.mutedForeground}
          >{`  ${activityText(activity)}`}</text>
        ))}
    </box>
  )
}
