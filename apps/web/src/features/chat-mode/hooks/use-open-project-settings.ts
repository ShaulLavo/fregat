import { useCommandBus } from '@/keymap/hooks/use-command-bus'
import { selectSettingsProject, type SettingsProject } from '@/lib/project-settings/state/selection'

/** Opens the settings page on one project's overrides, read from the machine that owns it. */
export function useOpenProjectSettings() {
  const bus = useCommandBus()
  return (project: SettingsProject) => {
    selectSettingsProject(project)
    void bus.dispatch('workspace.showSettings', {
      source: { kind: 'programmatic', caller: 'project-settings' },
    })
  }
}
