import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ProviderSnapshot } from '@workspace/contracts'
import {
  providerAuthMethodCopy,
  providerAuthStatusCopy,
} from '@workspace/client-core/chat/providers/auth'
import type { Client } from '@workspace/client-core/transport/client'
import { createProviderAuth } from '@/agent-models/state/auth'
import { useCommandFocus } from '@/commands/hooks/use-command-focus'
import { useCommands } from '@/commands/hooks/use-commands'
import { Dialog } from '@/components/dialog'
import { Select } from '@/components/select'
import { LoadingState } from '@/components/loading-state'
import { connectionFailure } from '@/connection/utils/failure'
import type { Theme } from '@/theme/utils/theme'

export function ProviderAccount({
  client,
  provider,
  theme,
  onClose,
  record,
}: {
  readonly client: Client
  readonly provider: ProviderSnapshot
  readonly theme: Theme
  readonly onClose: () => void
  readonly record?: (event: Record<string, unknown>) => void
}) {
  const commands = useCommands()
  const [store] = useState(() => createProviderAuth(client, provider.providerInstanceId, record))
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [selected, setSelected] = useState(0)
  const [failure, setFailure] = useState('')
  const pending = state.attempt?.state === 'pending'
  const status = providerAuthStatusCopy(state.auth?.auth ?? provider.auth)
  const methods = state.auth?.signInMethods ?? []
  const options = methods.map((method) => ({
    name: providerAuthMethodCopy(method).label,
    description: providerAuthMethodCopy(method).description,
    value: method,
  }))
  useEffect(() => {
    void store.refresh()
    return () => store.dispose()
  }, [store])
  useCommandFocus(
    {
      ...commands.focus.getSnapshot().scope,
      id: 'agent-provider-account',
      area: 'dialog',
      textEntry: false,
      overlay: true,
      focus: () => true,
    },
    true,
  )
  async function close() {
    if (state.busy) return
    try {
      await store.cancel()
      onClose()
    } catch (error) {
      setFailure(connectionFailure(error).message)
    }
  }
  return (
    <Dialog
      title={`${provider.displayLabel} account`}
      theme={theme}
      onClose={() => {
        void close()
      }}
      width={90}
      height={25}
    >
      <scrollbox
        id='agent-provider-account'
        focused={!state.auth?.supportsSignIn || state.busy || pending}
        flexGrow={1}
        minHeight={0}
      >
        <text fg={theme.foreground}>
          {status.title}
          {status.detail ? ` · ${status.detail}` : ''}
        </text>
        {state.busy && <LoadingState theme={theme} label='Contacting provider…' />}
        {!state.busy &&
          !pending &&
          state.auth?.supportsSignIn &&
          state.auth.auth.status !== 'authenticated' && (
            <Select
              id='agent-provider-methods'
              options={options}
              selectedIndex={selected}
              onChange={setSelected}
              onSelect={(index) => {
                const method = options[index]?.value
                if (method) void store.start(method)
              }}
              focused
              height={Math.min(9, options.length * 2 + 1)}
              textColor={theme.foreground}
              selectedTextColor={theme.primary}
              selectedBackgroundColor={theme.accent}
            />
          )}
        {!state.busy &&
          !pending &&
          state.auth?.supportsSignIn &&
          state.auth.auth.status === 'authenticated' && (
            <Select
              id='agent-provider-methods'
              options={[
                {
                  name: 'Sign out',
                  description: 'Sign out this provider on the server',
                  value: 'logout',
                },
              ]}
              focused
              height={3}
              onSelect={() => {
                void store.signOut()
              }}
              textColor={theme.foreground}
              selectedTextColor={theme.primary}
              selectedBackgroundColor={theme.accent}
            />
          )}
        {state.auth && !state.auth.supportsSignIn && (
          <text fg={theme.mutedForeground}>
            Sign-in for this provider is managed by its CLI on the server.
          </text>
        )}
        {pending && (
          <text fg={theme.info}>
            Finish sign-in in the browser opened on the server’s machine. Close this dialog to
            cancel the attempt.
          </text>
        )}
        {state.attempt && (
          <box flexDirection='column'>
            <text fg={theme.foreground}>
              {[state.attempt.state, state.attempt.message, ...state.attempt.outputTail]
                .filter(Boolean)
                .join('\n')}
            </text>
          </box>
        )}
        {(state.error || failure) && <text fg={theme.destructive}>{failure || state.error}</text>}
      </scrollbox>
    </Dialog>
  )
}
