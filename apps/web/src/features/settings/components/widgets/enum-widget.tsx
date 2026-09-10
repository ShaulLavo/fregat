import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select'
import type { SettingId } from '@workspace/contracts'
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
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {settingOptionTitle(id, option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
