import type { AgentLocation } from '@/agent/utils/target'
import { useEffect, useState } from 'react'
import { useRenderer } from '@opentui/react'

import { useCommands } from '@/commands/hooks/use-commands'
import { useCommandFocus } from '@/commands/hooks/use-command-focus'
import { Dialog } from '@/components/dialog'
import { Prompt } from '@/components/prompt'
import { Spinner } from '@/components/spinner'
import { Toast } from '@/components/toast'
import type { SessionState, SettingsSession } from '@/connection/state/session'
import { connectionFailure } from '@/connection/utils/failure'
import { locationAddress, resolveAddress } from '@/navigation/utils/address'
import type { Location } from '@/navigation/state/history'
import { type WorkbenchLocation } from '@/workbench/utils/location'
import type { Theme } from '@/theme/utils/theme'

export function AddressDialog({
  session,
  state,
  theme,
  onClose,
  onSettings,
  onWorkbench,
  onAgent,
  location,
  copy = false,
}: {
  session: SettingsSession
  state: Extract<SessionState, { kind: 'ready' }>
  theme: Theme
  onClose: () => void
  onSettings: (query: string) => void
  onWorkbench: (location: WorkbenchLocation) => void
  onAgent: (location: AgentLocation) => void
  copy?: boolean
  location: Location
}) {
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(copy)
  const [failure, setFailure] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [controller] = useState(() => new AbortController())
  const commands = useCommands()
  const renderer = useRenderer()
  useCommandFocus(
    {
      ...commands.focus.getSnapshot().scope,
      id: 'address-input',
      area: 'dialog',
      textEntry: true,
      overlay: true,
      focus: () => true,
    },
    true,
  )
  useEffect(() => {
    if (!copy) return
    void locationAddress(
      state.descriptor.environmentId,
      location,
      { client: session.client, signal: controller.signal },
      state.chat.getSnapshot().projection,
    )
      .then((address) => {
        if (controller.signal.aborted) return
        if (address === null) {
          setFailure('This location has no shareable address.')
          return
        }
        setInput(address)
        setCopied(renderer.copyToClipboardOSC52(address))
      })
      .catch((error) => {
        if (!controller.signal.aborted) setFailure(connectionFailure(error).message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setPending(false)
      })
  }, [
    copy,
    renderer,
    location,
    session.client,
    state.descriptor.environmentId,
    state.chat,
    controller,
  ])
  useEffect(() => () => controller.abort(), [controller])
  const open = async (value: string) => {
    if (pending) return
    if (state.connection.kind !== 'live') {
      setFailure('Reconnect before opening an address.')
      return
    }
    setPending(true)
    setFailure(null)
    try {
      const result = await resolveAddress(
        value,
        session.client,
        state.descriptor.environmentId,
        controller.signal,
      )
      controller.signal.throwIfAborted()
      if (result.kind === 'failed') {
        setFailure(result.message)
        return
      }
      if (result.kind === 'settings') {
        onSettings(result.query)
        return
      }
      if (result.kind === 'agent') {
        onAgent(result)
        return
      }
      onWorkbench(result)
    } catch (error) {
      if (!controller.signal.aborted) setFailure(connectionFailure(error).message)
    } finally {
      if (!controller.signal.aborted) setPending(false)
    }
  }
  return (
    <Dialog
      title={copy ? 'Current address' : 'Open address'}
      theme={theme}
      onClose={onClose}
      footer='Enter open'
      dismissLabel='close'
      width={100}
    >
      <Prompt
        id='address-input'
        value={input}
        onChange={setInput}
        onSubmit={(value) => void open(value)}
        theme={theme}
        disabled={pending}
        placeholder='Paste a Platform address…'
      />
      {copy && !pending && !failure && (
        <text fg={theme.mutedForeground}>
          {copied
            ? 'Copied through the terminal clipboard.'
            : 'Select the address above to copy it from your terminal.'}
        </text>
      )}
      {pending && <Spinner theme={theme} />}
      {failure && <Toast message={failure} tone='error' theme={theme} durationMs={0} />}
    </Dialog>
  )
}
