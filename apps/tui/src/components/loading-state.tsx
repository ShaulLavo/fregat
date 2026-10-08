import { useEffect, useState } from 'react'

import type { Theme } from '@/theme/utils/theme'

export function LoadingState({
  theme,
  label = 'Connecting to Fregat…',
}: {
  theme: Theme
  label?: string
}) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 120)
    return () => clearTimeout(timer)
  }, [])
  return (
    <box flexGrow={1} padding={2} gap={1} flexDirection='column'>
      <text fg={theme.mutedForeground}>{label}</text>
      {visible && (
        <text fg={theme.noColor ? theme.mutedForeground : theme.muted}>
          {'━━━━━━━━━━━━━━━━━━━━━━\n\n━━━━━━━━━━━━━━━━\n\n━━━━━━━━━━━━━━━━━━'}
        </text>
      )}
    </box>
  )
}
