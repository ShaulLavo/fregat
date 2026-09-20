import { useKeyboard } from '@opentui/react'
import type { ProviderApprovalDecision } from '@workspace/contracts'
import type { PendingApproval } from '@workspace/client-core/chat/pending-approvals'
import { usePaneFocus } from '@/commands/hooks/use-pane-focus'
import { Select } from '@/components/select'
import { OrbitLoader } from '@/components/orbit-loader'
import type { Theme } from '@/theme/utils/theme'

export function Approval({
  request,
  theme,
  enabled,
  busy,
  onRespond,
}: {
  readonly request: PendingApproval
  readonly theme: Theme
  readonly enabled: boolean
  readonly busy: boolean
  readonly onRespond: (decision: ProviderApprovalDecision) => void
}) {
  const choices = request.options.map((option, index) => ({
    label: `${index + 1} ${option.label}`,
    value: option.decision,
  }))
  const focused = usePaneFocus({ id: 'agent-approval', area: 'chat', enabled: enabled && !busy })
  useKeyboard((event) => {
    if (!focused || event.defaultPrevented || event.ctrl || event.meta) return
    const choice = choices[Number(event.name) - 1]
    if (!choice) return
    event.preventDefault()
    onRespond(choice.value)
  })
  return (
    <box flexDirection='column' border borderColor={theme.warning} paddingX={1} flexShrink={0}>
      <text fg={theme.warning}>
        <strong>Approval needed</strong>
      </text>
      <text fg={theme.foreground}>
        {request.detail ?? request.requestType ?? 'The agent requested permission.'}
      </text>
      {busy ? (
        <box>
          <OrbitLoader theme={theme} />
          <text> Sending decision…</text>
        </box>
      ) : (
        <Select
          id='agent-approval'
          focused={focused}
          height={choices.length}
          showDescription={false}
          textColor={theme.foreground}
          selectedTextColor={theme.primaryForeground}
          selectedBackgroundColor={theme.primary}
          options={choices.map((choice) => ({
            name: choice.label,
            description: '',
            value: choice.value,
          }))}
          onSelect={(index) => {
            const choice = choices[index]
            if (choice) onRespond(choice.value)
          }}
        />
      )}
    </box>
  )
}
