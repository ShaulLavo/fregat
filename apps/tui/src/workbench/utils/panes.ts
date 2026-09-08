import type { FocusArea } from '@workspace/client-core/commands/focus'
import type { FocusTarget } from '@/commands/state/focus'
import type { WorkbenchPane } from '@/workbench/utils/location'

export const paneLabels = {
  files: 'Files',
  git: 'Git',
  search: 'Search',
  terminal: 'Terminal',
  problems: 'Problems',
  logs: 'Logs',
} satisfies Record<WorkbenchPane, string>

export const paneAreas = {
  files: 'editor',
  git: 'git',
  search: 'search',
  terminal: 'terminal',
  problems: 'problems',
  logs: 'logs',
} satisfies Record<WorkbenchPane, FocusArea>

const primaryTargets: Partial<Record<FocusArea, string>> = {
  'file-tree': 'workbench-file-tree',
  editor: 'workbench-viewer',
  git: 'workbench-git',
  search: 'search-query',
  problems: 'workbench-problems',
  logs: 'logs-filter',
}

export function primaryPaneTarget(target: FocusTarget, area: FocusArea) {
  if (target.area !== area || target.capabilities.overlay) return false
  return primaryTargets[area] === undefined || target.widgetId === primaryTargets[area]
}
