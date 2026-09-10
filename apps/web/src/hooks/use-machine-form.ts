import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { MachineDefinition } from '@workspace/contracts'
import { useSettingValue } from '@/features/settings/hooks/use-setting-value'
import { useSettingsActions } from '@/features/settings/hooks/use-settings-actions'
import { useEnvironmentConnections } from '@/hooks/use-environment-connections'
import { errorMessage } from '@/lib/error-message'
import { createWideEventScope } from '@/lib/wide-event-scope'
import { machineDraft, parseMachineDraft, type MachineDraft } from '@/utils/machine-form'

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
    } finally {
      event.end()
    }
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

  async function save(event: FormEvent) {
    event.preventDefault()
    if (pending.current) return
    const parsed = parseMachineDraft(draft)
    if (parsed.kind === 'invalid') return setError(parsed.message)
    if (!name && savedName !== parsed.name && Object.hasOwn(machines, parsed.name)) {
      setOptionsOpen(true)
      return setError('That machine name is already in use. Choose another name under Options.')
    }
    const abort = beginSave(parsed.name)
    setError(null)
    setSaving(true)
    try {
      const submission = setMachine(parsed.name, parsed.machine)
      const result = submission.kind === 'noop' ? 'acknowledged' : await submission.settled
      if (abort.signal.aborted) return
      if (result !== 'acknowledged')
        return setError('The machine could not be saved. Retry after resolving the settings error.')
      setSavedName(parsed.name)
      setDraft((current) => ({ ...current, name: parsed.name }))
      const connected =
        intent !== 'connect' || (await connect(parsed.name, parsed.machine, abort.signal))
      if (abort.signal.aborted || !connected) return
      pending.current = null
      onSaved(parsed.name)
    } catch (cause) {
      if (!abort.signal.aborted)
        setError(errorMessage(cause, 'The machine could not be saved or connected.'))
    } finally {
      if (pending.current === abort) pending.current = null
      if (!abort.signal.aborted) setSaving(false)
    }
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
    const connected = connections.store
      .getState()
      .machines.find((entry) => entry.name === machineName)
    setError(
      connected?.lastError || `Cannot connect to ${machineName}. Check the address and try again.`,
    )
    return false
  }

  return { draft, error, saving, optionsOpen, setOptionsOpen, update, save, cancel, submitLabel }
}
