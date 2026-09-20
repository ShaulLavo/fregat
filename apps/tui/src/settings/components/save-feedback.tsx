import { Spinner } from '@/components/spinner'
import type { Theme } from '@/theme/utils/theme'

export function SaveFeedback({
  failure,
  pending,
  label,
  theme,
}: {
  failure: string | null
  pending: boolean
  label: string
  theme: Theme
}) {
  return (
    <>
      {failure && <text fg={theme.destructive}>{failure}</text>}
      {pending && (
        <box flexDirection='row' gap={1}>
          <Spinner theme={theme} />
          <text fg={theme.mutedForeground}>{label}</text>
        </box>
      )}
    </>
  )
}
