import { useQuery } from '@tanstack/react-query'
import {
  providerModelOptions,
  providerModelSelectionKey,
} from '@workspace/client-core/chat/providers/models'
import type { SettingsValues } from '@workspace/contracts'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select'

import { useSettingsActions } from '@/features/settings/hooks/use-settings-actions'
import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'
import { projectModelLabel } from '@/features/settings/utils/project-settings'
import { providerListQueryOptions } from '@/lib/provider-query'

export function ProjectTitleModelRow({
  projectId,
  values,
}: {
  readonly projectId: string
  readonly values: SettingsValues
}) {
  const { data } = useQuery(providerListQueryOptions(), useSettingsOwner())
  const { setProjectOverride } = useSettingsActions()
  const selected = values['chat.projectTextGenerationModels'][projectId]
  const fallback = values['chat.textGenerationModel']
  const options = providerModelOptions(data?.providers)
  const choices = new Map(
    options.map((option) => [
      option.key,
      {
        label: `${option.providerLabel} · ${option.name}`,
        selection: option.modelSelection,
      },
    ]),
  )
  if (selected)
    choices.set(providerModelSelectionKey(selected), {
      label: choices.get(providerModelSelectionKey(selected))?.label ?? projectModelLabel(selected),
      selection: selected,
    })
  const current = selected ? providerModelSelectionKey(selected) : 'default'
  const shown = selected ? choices.get(current)?.label : `Default · ${projectModelLabel(fallback)}`

  return (
    <div
      className='flex flex-col gap-(--density-control-gap) py-(--density-section-padding) @3xl/settings:flex-row @3xl/settings:items-start @3xl/settings:justify-between @3xl/settings:gap-6'
      data-project-setting='project-title-model'
    >
      <div className='flex min-w-0 flex-col gap-1'>
        <label className='text-foreground text-sm font-medium' htmlFor='project-title-model'>
          Title generation model
        </label>
        <code className='text-muted-foreground font-mono text-xs'>
          chat.projectTextGenerationModels
        </code>
        <p className='text-muted-foreground text-xs'>
          Provider and model that write this project's session titles on its machine.
        </p>
      </div>
      <Select
        value={current}
        onValueChange={(next) => {
          if (next === null || next === current) return
          const selection = next === 'default' ? null : choices.get(next)?.selection
          if (selection === undefined) return
          setProjectOverride({
            key: 'chat.projectTextGenerationModels',
            projectId,
            value: selection,
          })
        }}
      >
        <SelectTrigger className='w-64 @max-3xl/settings:w-full' id='project-title-model'>
          <SelectValue>{shown}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value='default'>Default · {projectModelLabel(fallback)}</SelectItem>
          {Array.from(choices, ([key, option]) => (
            <SelectItem key={key} value={key}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
