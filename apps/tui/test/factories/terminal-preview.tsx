import { CommandProvider } from '@/commands/providers/command-provider'
import { HostActionsContext } from '@/host/providers/actions-context'
import { TerminalPane } from '@/terminal/components/pane'
import type { SettingsSession } from '@/connection/state/session'
import { resolveTheme } from '@/theme/utils/theme'

export function TerminalPreview({
  session,
  rootPath,
}: {
  readonly session: SettingsSession
  readonly rootPath: string
}) {
  const ready = session.getSnapshot()
  if (ready.kind !== 'ready') return null
  return (
    <HostActionsContext value={{ quit: () => {} }}>
      <CommandProvider
        scope={{
          screen: 'workbench',
          environmentId: ready.descriptor.environmentId,
          projectId: rootPath,
        }}
        handlers={{}}
        overrides={{}}
        onError={(error) => {
          throw error
        }}
      >
        <TerminalPane
          session={session}
          rootPath={rootPath}
          theme={resolveTheme('dark', 'dark', true)}
          enabled
        />
      </CommandProvider>
    </HostActionsContext>
  )
}
