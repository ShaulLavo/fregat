import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select'
import { typeFilterOptions } from '@/features/file-picker/utils/type-filter'

export function TypeFilter({
  accept,
  value,
  onChange,
}: {
  accept: readonly string[]
  value: string
  onChange: (value: string) => void
}) {
  const options = typeFilterOptions(accept)
  const label = options.find((option) => option.value === value)?.label ?? options[0]?.label
  return (
    <Select items={options} value={value} onValueChange={(next) => onChange(next ?? '')}>
      <SelectTrigger aria-label='File type' className='max-w-56 min-w-0' size='sm' title={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent side='top' align='start'>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
