import { scopedProjectKey, type ScopedProjectRef } from '@workspace/contracts'

import { ProjectSettingRow } from '@/features/settings/components/project-setting-row'
import { useSettingsProjection } from '@/features/settings/hooks/use-settings-projection'
import type { ProjectSettingRow as Row } from '@/features/settings/utils/project-settings'
import { DEFAULT_CHOICE } from '@/features/settings/utils/project-settings'
import { settingOptionTitle } from '@workspace/client-core/settings/humanize'

const ROW: Row = {
  id: 'project-grouping',
  global: 'chat.projectGrouping',
  key: 'chat.projectGroupingOverrides',
  choices: () =>
    (['repository', 'repository_path', 'separate'] as const).map((mode) => ({
      value: mode,
      label: settingOptionTitle('chat.projectGrouping', mode),
    })),
  defaultLabel: (values) =>
    settingOptionTitle('chat.projectGrouping', values['chat.projectGrouping']),
  current: (values, key) => values['chat.projectGroupingOverrides'][key] ?? DEFAULT_CHOICE,
  write: (_values, projectId, choice) => ({
    key: 'chat.projectGroupingOverrides',
    projectId,
    value:
      choice === 'repository' || choice === 'repository_path' || choice === 'separate'
        ? choice
        : null,
  }),
}

export function ProjectGroupingRow({ project }: { readonly project: ScopedProjectRef }) {
  const projection = useSettingsProjection()
  if (!projection) return null
  return (
    <div>
      <p className='text-muted-foreground text-xs'>
        Grouping is saved on this machine for this project's machine and ID.
      </p>
      <ProjectSettingRow
        projectId={scopedProjectKey(project)}
        row={ROW}
        values={projection.values}
      />
    </div>
  )
}
