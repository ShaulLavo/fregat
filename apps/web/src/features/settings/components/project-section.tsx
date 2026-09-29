import { StatusMessage } from '@/components/status-message'
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
        Settings for this project only, saved on the machine that has it. Default uses that
        machine's own setting.
      </p>
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
