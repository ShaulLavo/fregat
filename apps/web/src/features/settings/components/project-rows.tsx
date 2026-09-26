import { Spinner } from '@workspace/ui/components/spinner'

import { ProjectSettingRow } from '@/features/settings/components/project-setting-row'
import { useSettingsProjection } from '@/features/settings/hooks/use-settings-projection'
import { PROJECT_SETTING_ROWS } from '@/features/settings/utils/project-settings'

/** The project's overrides as the owning machine's settings resolve them. */
export function ProjectRows({ projectId }: { readonly projectId: string }) {
  const projection = useSettingsProjection()
  if (!projection) return <Spinner size='md' label='Loading project settings' />

  return PROJECT_SETTING_ROWS.map((row) => (
    <ProjectSettingRow key={row.id} projectId={projectId} row={row} values={projection.values} />
  ))
}
