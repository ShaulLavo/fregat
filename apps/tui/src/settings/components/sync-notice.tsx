import { useStore } from 'zustand'
import type { SettingsOwner } from '@workspace/client-core/settings/owner'
import { useCommands } from '@/commands/hooks/use-commands'
import type { Theme } from '@/theme/utils/theme'

export function SyncNotice({ owner, theme }: { owner: SettingsOwner; theme: Theme }) {
  const streamStop = useStore(owner.store, (state) => state.streamStop)
  const { bindings } = useCommands()
  if (!streamStop) return null
  const reconnect = bindings.find((binding) => binding.command === 'workspace.reconnect')?.keys
  const fix =
    streamStop.reason === 'unreadable'
      ? "Update the TUI and restart to read this server's settings."
      : `${reconnect ? `${reconnect} · ` : ''}Reconnect to retry.`
  return (
    <text fg={theme.warning} paddingX={2} flexShrink={0}>
      {`Settings stopped syncing. ${fix}`}
    </text>
  )
}
