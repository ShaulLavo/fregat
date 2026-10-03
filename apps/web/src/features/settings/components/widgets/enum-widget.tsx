import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select'
import type { SettingId } from '@workspace/contracts'
import { materialOptionReason, settingEnvironment } from '@/features/settings/utils/availability'
import { settingOptionTitle } from '@workspace/client-core/settings/humanize'

export function EnumWidget({
  disabled,
  id,
  onChange,
  options,
  value,
}: {
  disabled?: boolean
  id: SettingId
  onChange: (next: string) => void
  options: readonly string[]
  value: string
}) {
  const environment = settingEnvironment()
  return (
    <Select
      disabled={disabled}
      onValueChange={(next) => {
        // base-ui hands back `null` when a selection is cleared; there is no
        // "unset" state for an enum setting, so that is simply not a change.
        if (next === null) return
        onChange(next)
      }}
      value={value}
    >
      <SelectTrigger className='w-44 @max-3xl/settings:w-full' id={id}>
        <SelectValue>{settingOptionTitle(id, value)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => {
          const reason = id === 'window.material' ? materialOptionReason(option, environment) : null
          return (
            <SelectItem
              disabled={reason !== null}
              key={option}
              value={option}
              title={reason ?? undefined}
            >
              {settingOptionTitle(id, option)}
              {reason ? <span className='text-muted-foreground text-xs'>{reason}</span> : null}
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}
