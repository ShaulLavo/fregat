import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { MachineDefinition } from '@workspace/contracts'
import { useSettingValue } from '@/hooks/use-setting-value'
import { useSettingsActions } from '@/features/settings/hooks/use-settings-actions'
import { useEnvironmentConnections } from '@/hooks/use-environment-connections'
import { errorMessage } from '@/lib/error-message'
import { clientErrorDescription } from '@/lib/client-error-taxonomy'
import { createWideEventScope } from '@/lib/wide-event-scope'
import {
  machineDraft,
  parseMachineDraft,
  sameMachineAddress,
  type MachineDraft,
} from '@/hooks/utils/machine-form'

export type MachineFormOptions = {
  readonly name?: string
  readonly machine?: MachineDefinition
  readonly intent?: 'manage' | 'connect'
  readonly onCancel: () => void
  readonly onSaved: (name: string) => void
}

export function useMachineForm({
  name,
  machine,
  intent = 'manage',
  onCancel,
  onSaved,
}: MachineFormOptions) {
  const [draft, setDraft] = useState(() => machineDraft(name, machine))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedName, setSavedName] = useState<string | null>(null)
  const [optionsOpen, setOptionsOpen] = useState(name !== undefined)
  const pending = useRef<AbortController | null>(null)
  const machines = useSettingValue('environments.machines')
  const { setMachine } = useSettingsActions()
  const connections = useEnvironmentConnections()
  let submitLabel = name ? 'Save machine' : 'Add machine'
  if (intent === 'connect') submitLabel = 'Connect'

  useEffect(() => () => pending.current?.abort(), [])

  function update<K extends keyof MachineDraft>(key: K, value: MachineDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
    setError(null)
  }

  function cancel() {
    pending.current?.abort()
    setSaving(false)
    onCancel()
  }

  async function cancelConnection(machineName: string) {
    const event = createWideEventScope({
      action: 'machine.form.cancel',
      area: 'environments',
      machine: machineName,
    })
    try {
      await connections.cancelMachine(machineName)
    } catch (cause) {
      event.error(cause)
    }
    event.end()
  }

  function beginSave(machineName: string) {
    const abort = new AbortController()
    if (intent === 'connect')
      abort.signal.addEventListener('abort', () => void cancelConnection(machineName), {
        once: true,
      })
    pending.current = abort
    return abort
  }

  async function connect(machineName: string, definition: MachineDefinition, signal: AbortSignal) {
    connections.configureMachines({ ...machines, [machineName]: definition })
    const result = await connections.connectMachine(machineName)
    if (signal.aborted) return false
    if (result === 'connected') return true
    if (result === 'cancelled') {
      setError('Connection canceled.')
      return false
    }
    const failure = connections.store
      .getState()
      .machines.find((entry) => entry.name === machineName)?.lastError
    setError(
      failure
        ? clientErrorDescription(failure)
        : `Cannot connect to ${machineName}. Check the address and try again.`,
    )
    return false
  }

  /** Returns the message to show, or null when it succeeded or the caller aborted. */
  async function runSave(machineName: string, definition: MachineDefinition, signal: AbortSignal) {
    try {
      const submission = setMachine(machineName, definition)
      const result = submission.kind === 'noop' ? 'acknowledged' : await submission.settled
      if (signal.aborted) return null
      if (result !== 'acknowledged')
        return 'The machine could not be saved. Retry after resolving the settings error.'
      setSavedName(machineName)
      setDraft((current) => ({ ...current, name: machineName }))
      const connected = intent !== 'connect' || (await connect(machineName, definition, signal))
      if (signal.aborted || !connected) return null
      pending.current = null
      onSaved(machineName)
      return null
    } catch (cause) {
      if (signal.aborted) return null
      return errorMessage(cause, 'The machine could not be saved or connected.')
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (pending.current) return
    const parsed = parseMachineDraft(draft)
    if (parsed.kind === 'invalid') return setError(parsed.message)
    const saved = Object.hasOwn(machines, parsed.name) ? machines[parsed.name] : undefined
    // A saved machine at the same address is this one again: connect it rather than refuse.
    if (!name && savedName !== parsed.name && saved && !sameMachineAddress(saved, parsed.machine)) {
      setOptionsOpen(true)
      return setError(
        `A saved machine named ${parsed.name} points somewhere else. Choose another name under Options.`,
      )
    }
    const abort = beginSave(parsed.name)
    setError(null)
    setSaving(true)
    const failure = await runSave(parsed.name, parsed.machine, abort.signal)
    if (pending.current === abort) pending.current = null
    if (abort.signal.aborted) return

    setSaving(false)
    if (failure) setError(failure)
  }

  return { draft, error, saving, optionsOpen, setOptionsOpen, update, save, cancel, submitLabel }
}
