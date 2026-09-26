import type { SettingsValues } from '@workspace/contracts'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select'

import { useSettingsActions } from '@/features/settings/hooks/use-settings-actions'
import {
  DEFAULT_CHOICE,
  projectRowDescription,
  projectRowTitle,
  type ProjectSettingRow as Row,
} from '@/features/settings/utils/project-settings'

/** One override for one project: the machine-wide value, or a choice of its own. */
export function ProjectSettingRow({
  projectId,
  row,
  values,
}: {
  readonly projectId: string
  readonly row: Row
  readonly values: SettingsValues
}) {
  const { setProjectOverride } = useSettingsActions()
  const current = row.current(values, projectId)
  const choices = [
    { value: DEFAULT_CHOICE, label: `Default · ${row.defaultLabel(values)}` },
    ...row.choices(values),
  ]
  const shown = choices.find((choice) => choice.value === current)?.label ?? current

  return (
    <div
      className='flex flex-col gap-(--density-control-gap) py-(--density-section-padding) @3xl/settings:flex-row @3xl/settings:items-start @3xl/settings:justify-between @3xl/settings:gap-6'
      data-project-setting={row.id}
    >
      <div className='flex min-w-0 flex-col gap-1 @max-3xl/settings:wrap-anywhere'>
        <div className='flex flex-wrap items-center gap-2'>
          <label className='text-foreground text-sm font-medium' htmlFor={row.id}>
            {projectRowTitle(row)}
          </label>
          <code className='text-muted-foreground font-mono text-xs'>{row.key}</code>
        </div>
        <p className='text-muted-foreground text-xs'>{projectRowDescription(row)}</p>
      </div>
      <Select
        onValueChange={(next) => {
          // base-ui hands back `null` when a selection is cleared; the default is its own choice.
          if (next === null || next === current) return
          setProjectOverride(row.write(values, projectId, next))
        }}
        value={current}
      >
        <SelectTrigger className='w-44 @max-3xl/settings:w-full' id={row.id}>
          <SelectValue>{shown}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {choices.map((choice) => (
            <SelectItem key={choice.value} value={choice.value}>
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
