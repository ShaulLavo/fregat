import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { useSettingValue } from '@/hooks/use-setting-value'
import { useSettingsActions } from '../hooks/use-settings-actions'
import { useSettingsScope, writableSettingsScope } from '../state/scope-store'

const preferences = [
  { value: 'prefer', label: 'Prefer' },
  { value: 'normal', label: 'Normal' },
  { value: 'less-often', label: 'Less often' },
  { value: 'manual-only', label: 'Manual only' },
] as const

export function MachinePreferences({ disabled }: { readonly disabled: boolean }) {
  const entries = useEnvironmentsStore((state) => state.entries)
  const saved = useSettingValue('environments.loadPreferences')
  const { setSetting } = useSettingsActions()
  const scope = writableSettingsScope(useSettingsScope())
  const machines = Object.values(entries).filter((entry) => entry.environmentId)
  return (
    <div className='flex w-full min-w-0 flex-col gap-(--density-control-gap)'>
      {machines.map((machine) => (
        <div key={machine.origin} className='flex min-w-0 items-center gap-(--density-control-gap)'>
          <span
            className='text-foreground min-w-0 flex-1 truncate text-xs'
            title={machine.label ?? machine.name}
          >
            {machine.label ?? machine.name}
          </span>
          <Select
            disabled={disabled}
            value={saved[machine.environmentId!] ?? 'normal'}
            onValueChange={(value) => {
              const preference = preferences.find((entry) => entry.value === value)
              if (!preference) return
              setSetting(
                'environments.loadPreferences',
                { ...saved, [machine.environmentId!]: preference.value },
                scope,
              )
            }}
          >
            <SelectTrigger
              aria-label={`${machine.label ?? machine.name} selection preference`}
              className='w-36'
            >
              <SelectValue>
                {
                  preferences.find(
                    (entry) => entry.value === (saved[machine.environmentId!] ?? 'normal'),
                  )?.label
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {preferences.map((entry) => (
                <SelectItem key={entry.value} value={entry.value}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
      {machines.length === 0 ? (
        <p className='text-muted-foreground text-xs'>
          Connect a machine to choose its selection preference.
        </p>
      ) : null}
    </div>
  )
}
