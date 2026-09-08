import type { SyntaxStyle } from '@opentui/core'
import type { GroupedTimelineRow as Row } from '@/agent-stage/utils/timeline'
import { ActivityGroup } from '@/agent-stage/components/activity-group'
import type { Theme } from '@/theme/utils/theme'

export function TimelineRow({
  row,
  theme,
  syntax,
  expanded,
}: {
  readonly row: Row
  readonly theme: Theme
  readonly syntax: SyntaxStyle
  readonly expanded: boolean
}) {
  if (row.kind === 'activity-group')
    return <ActivityGroup activities={row.activities} theme={theme} expanded={expanded} />
  if (row.kind === 'plan')
    return (
      <box flexDirection='column' border borderColor={theme.info} paddingX={1} flexShrink={0}>
        <text fg={theme.info}>
          <strong>{row.plan.implementedAt ? 'Implemented plan' : 'Proposed plan'}</strong>
        </text>
        <markdown content={row.plan.planMarkdown} syntaxStyle={syntax} fg={theme.foreground} />
      </box>
    )
  const message = row.message
  return (
    <box
      flexDirection='column'
      gap={1}
      flexShrink={0}
      backgroundColor={message.role === 'user' ? theme.card : theme.background}
      border={message.role === 'user' ? ['left'] : false}
      borderColor={theme.border}
      paddingX={1}
    >
      <text fg={message.role === 'user' ? theme.primary : theme.foreground}>
        <strong>{message.role === 'user' ? 'You' : 'Assistant'}</strong>
      </text>
      <markdown
        content={message.text || ' '}
        streaming={message.streaming}
        syntaxStyle={syntax}
        fg={theme.foreground}
      />
      {message.attachments.map((attachment) => (
        <text
          key={attachment.id}
          fg={theme.info}
        >{`[Image: ${attachment.name} · ${Math.ceil(attachment.sizeBytes / 1024)} KiB]`}</text>
      ))}
    </box>
  )
}
