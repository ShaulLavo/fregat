import { projectMenu, type ProjectMenuContext } from '@/features/chat-mode/utils/project-menu'
import type { MenuActionItem, MenuItem } from '@/keymap/menus/utils/model'
import { expect, test } from '../../../../../test/fixtures'

test('offers a new session first, then manage, then the view controls, then copy', () => {
  expect(sectionIds(menuContext())).toEqual(['sessions', 'manage', 'view', 'copy'])
  expect(itemLabels(menuContext(), 'sessions')).toEqual(['New Session in This Project'])
  expect(itemLabels(menuContext(), 'copy')).toEqual(['Copy Path'])
})

test('offers settings, rename, archiving everything and deleting the project', () => {
  expect(itemLabels(menuContext(), 'manage')).toEqual([
    'Manage Worktrees',
    'Project Settings',
    'Rename Project',
    'Archive All Sessions',
    'Delete Project',
  ])
})

test('omits archive all once every session is already filed away', () => {
  expect(itemLabels(menuContext({ canArchiveSessions: false }), 'manage')).toEqual([
    'Manage Worktrees',
    'Project Settings',
    'Rename Project',
    'Delete Project',
  ])
})

test('delete is the only destructive item', () => {
  const destructive = actionsIn(menuContext())
    .filter((item) => item.destructive)
    .map((item) => item.label)

  expect(destructive).toEqual(['Delete Project'])
})

test('offers to narrow the list to the project', () => {
  expect(itemLabels(menuContext(), 'view')).toEqual(['Show Only This Project', 'Collapse Project'])
})

test('omits the scope item when the list already shows only that project', () => {
  expect(itemLabels(menuContext({ scopedToProject: true }), 'view')).toEqual(['Collapse Project'])
})

test('a collapsed project offers expand in collapse’s place, never both', () => {
  expect(itemLabels(menuContext({ collapsed: true }), 'view')).toEqual([
    'Show Only This Project',
    'Expand Project',
  ])
})

test('every item runs its own callback', () => {
  const calls: string[] = []
  const context = menuContext({ record: calls })
  for (const item of actionsIn(context)) {
    item.run()
  }

  expect(calls).toEqual([
    'newSession',
    'manageWorktrees',
    'openSettings',
    'renameProject',
    'archiveAllSessions',
    'deleteProject',
    'scopeToProject',
    'toggleCollapsed',
    'copyPath',
  ])
})

function actionsIn(context: ProjectMenuContext, sectionId?: string) {
  return projectMenu(context)
    .filter((entry) => !sectionId || entry.id === sectionId)
    .flatMap((entry) => entry.items)
    .filter(isActionItem)
}

function isActionItem(item: MenuItem | null | false): item is MenuActionItem {
  if (!item) return false

  return item.kind === 'action'
}

function sectionIds(context: ProjectMenuContext) {
  return projectMenu(context).map((entry) => entry.id)
}

function itemLabels(context: ProjectMenuContext, sectionId: string) {
  return actionsIn(context, sectionId).map((item) => item.label)
}

function menuContext({
  canArchiveSessions = true,
  collapsed = false,
  record = [],
  scopedToProject = false,
}: {
  canArchiveSessions?: boolean
  collapsed?: boolean
  record?: string[]
  scopedToProject?: boolean
} = {}): ProjectMenuContext {
  return {
    archiveAllSessions: () => record.push('archiveAllSessions'),
    canArchiveSessions,
    collapsed,
    copyPath: () => record.push('copyPath'),
    deleteProject: () => record.push('deleteProject'),
    manageWorktrees: () => record.push('manageWorktrees'),
    openSettings: () => record.push('openSettings'),
    newSession: () => record.push('newSession'),
    renameProject: () => record.push('renameProject'),
    scopedToProject,
    scopeToProject: () => record.push('scopeToProject'),
    toggleCollapsed: () => record.push('toggleCollapsed'),
  }
}
