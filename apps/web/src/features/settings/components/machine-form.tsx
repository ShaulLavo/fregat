import type { MachineDefinition } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { Spinner } from '@workspace/ui/components/spinner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select'
import { useId, useState, type FormEvent } from 'react'

import { useSettingValue } from '@/features/settings/hooks/use-setting-value'
import { useSettingsActions } from '@/features/settings/hooks/use-settings-actions'
import {
  machineDraft,
  parseMachineDraft,
  type MachineDraft,
} from '@/features/settings/utils/machine-form'

export function MachineForm({
  name,
  machine,
  onDone,
}: {
  readonly name?: string
  readonly machine?: MachineDefinition
  readonly onDone: () => void
}) {
  const id = useId()
  const [draft, setDraft] = useState(() => machineDraft(name, machine))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const machines = useSettingValue('environments.machines')
  const { setMachine } = useSettingsActions()
  const update = <K extends keyof MachineDraft>(key: K, value: MachineDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
    setError(null)
  }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    const parsed = parseMachineDraft(draft)
    if (parsed.kind === 'invalid') return setError(parsed.message)
    if (!name && Object.hasOwn(machines, parsed.name))
      return setError('That machine name is already in use.')
    setSaving(true)
    const submission = setMachine(parsed.name, parsed.machine)
    const result = submission.kind === 'noop' ? 'acknowledged' : await submission.settled
    setSaving(false)
    if (result !== 'acknowledged')
      return setError('The machine could not be saved. Retry after resolving the settings error.')
    onDone()
  }

  return (
    <form
      className='border-border flex flex-col gap-3 rounded-md border p-3'
      onSubmit={(event) => void save(event)}
    >
      <fieldset className='grid min-w-0 gap-3 @3xl/settings:grid-cols-2' disabled={saving}>
        <div className='flex flex-col gap-1'>
          <label className='text-xs font-medium' htmlFor={`${id}-name`}>
            Machine name
          </label>
          <Input
            id={`${id}-name`}
            disabled={name !== undefined}
            value={draft.name}
            onChange={(event) => update('name', event.currentTarget.value)}
            placeholder='build-machine'
          />
        </div>
        <div className='flex flex-col gap-1'>
          <label className='text-xs font-medium' htmlFor={`${id}-kind`}>
            Connection
          </label>
          <Select
            value={draft.kind}
            onValueChange={(value) => {
              if (value === 'ssh' || value === 'origin') update('kind', value)
            }}
          >
            <SelectTrigger id={`${id}-kind`} className='w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='ssh'>SSH</SelectItem>
              <SelectItem value='origin'>Direct origin</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className='flex flex-col gap-1 @3xl/settings:col-span-2'>
          <label className='text-xs font-medium' htmlFor={`${id}-label`}>
            Display label
          </label>
          <Input
            id={`${id}-label`}
            value={draft.label}
            onChange={(event) => update('label', event.currentTarget.value)}
            placeholder='Optional label'
          />
        </div>
        {draft.kind === 'ssh' ? (
          <>
            <div className='flex flex-col gap-1 @3xl/settings:col-span-2'>
              <label className='text-xs font-medium' htmlFor={`${id}-target`}>
                SSH target
              </label>
              <Input
                id={`${id}-target`}
                value={draft.target}
                onChange={(event) => update('target', event.currentTarget.value)}
                placeholder='user@host'
              />
            </div>
            <div className='flex flex-col gap-1 @3xl/settings:col-span-2'>
              <label className='text-xs font-medium' htmlFor={`${id}-path`}>
                Repository path
              </label>
              <Input
                id={`${id}-path`}
                value={draft.repoPath}
                onChange={(event) => update('repoPath', event.currentTarget.value)}
                placeholder='/work/projects/platform'
              />
            </div>
            <div className='flex flex-col gap-1'>
              <label className='text-xs font-medium' htmlFor={`${id}-port`}>
                Remote server port
              </label>
              <Input
                id={`${id}-port`}
                className='tabular-nums'
                type='number'
                min={1}
                max={65535}
                value={draft.remotePort}
                onChange={(event) => update('remotePort', event.currentTarget.value)}
                placeholder='Automatic'
              />
            </div>
          </>
        ) : (
          <div className='flex flex-col gap-1 @3xl/settings:col-span-2'>
            <label className='text-xs font-medium' htmlFor={`${id}-url`}>
              Server URL
            </label>
            <Input
              id={`${id}-url`}
              value={draft.url}
              onChange={(event) => update('url', event.currentTarget.value)}
              placeholder='http://127.0.0.1:3002'
            />
          </div>
        )}
      </fieldset>
      {error ? (
        <p role='alert' className='text-destructive text-xs'>
          {error}
        </p>
      ) : null}
      <div className='flex justify-end gap-2'>
        <Button type='button' variant='ghost' disabled={saving} onClick={onDone}>
          Cancel
        </Button>
        <Button type='submit' disabled={saving}>
          {saving ? <Spinner /> : null}
          {name ? 'Save machine' : 'Add machine'}
        </Button>
      </div>
    </form>
  )
}
