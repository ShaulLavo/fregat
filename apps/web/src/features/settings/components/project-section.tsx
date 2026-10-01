import { StatusMessage } from '@/components/status-message'
import { ProjectGroupingRow } from '@/features/settings/components/project-grouping-row'
import { ProjectRows } from '@/features/settings/components/project-rows'
import { SettingsOwnerProvider } from '@/features/settings/providers/owner-provider'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { queryClientFor } from '@/lib/environments/state/query-clients'
import type { SettingsProject } from '@/lib/project-settings/state/selection'

/** A project's settings, read from and written to the machine that owns the project. */
export function ProjectSection({ project }: { readonly project: SettingsProject }) {
  const origin = useEnvironmentsStore(
    (state) =>
      Object.values(state.entries).find(
        (entry) => entry.environmentId === project.ref.environmentId,
      )?.origin,
  )

  return (
    <section className='mb-6' aria-label={`${project.title} settings`}>
      <h2 className='text-foreground mb-1 text-sm font-semibold'>{project.title}</h2>
      <p className='text-muted-foreground text-xs'>
        Session and Git settings are saved on the machine that owns this project. Default uses that
        machine's setting.
      </p>
      <ProjectGroupingRow project={project.ref} />
      {origin ? (
        <SettingsOwnerProvider queryClient={queryClientFor(origin)}>
          <ProjectRows projectId={project.ref.projectId} />
        </SettingsOwnerProvider>
      ) : (
        <StatusMessage>The machine that owns this project is not connected.</StatusMessage>
      )}
    </section>
  )
}
