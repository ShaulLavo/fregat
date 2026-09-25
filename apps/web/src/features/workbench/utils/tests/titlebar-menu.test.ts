import type { MenuItem, MenuRadioGroupItem, MenuSubmenuItem } from '@/keymap/menus/utils/model'
import type { ProjectMenuEntry } from '@/features/workbench/utils/project-menu-model'
import { titlebarMenu, type TitlebarMenuContext } from '@/features/workbench/utils/titlebar-menu'
import { expect, test } from '../../../../../test/fixtures'

const projects: readonly ProjectMenuEntry[] = [
  { qualifier: null, rootPath: '/repo', title: 'repo' },
  { qualifier: 'work', rootPath: '/work/web', title: 'web' },
]

test('sections run project, view, settings, then copy', () => {
  expect(titlebarMenu(menuContext()).map((entry) => entry.id)).toEqual([
    'project',
    'view',
    'settings',
    'copy',
  ])
})

test('Theme and Settings stay offered with no workspace open', () => {
  expect(labels(menuContext({ projects: [], workspacePath: null }), 'settings')).toEqual([
    'Theme…',
    'Settings…',
  ])
})

test('the project section leads with Open Folder, then Switch Project', () => {
  expect(labels(menuContext(), 'project')).toEqual(['Open Folder…', 'Switch Project'])
})

test('the view section runs palette, mode radio, then Light / dark mode', () => {
  expect(labels(menuContext(), 'view')).toEqual([
    'Command Palette…',
    'workspace.showWorkbenchMode',
    'Light / dark mode',
  ])
})

test('drops the Switch Project submenu when no project is known', () => {
  expect(labels(menuContext({ projects: [] }), 'project')).toEqual(['Open Folder…'])
})

test('the project submenu checks the open root', () => {
  const group = projectRadio(menuContext())

  expect(group.value).toBe('/repo')
  expect(group.options.map((option) => option.value)).toEqual(['/repo', '/work/web'])
})

test('a qualified project carries its parent hint in the label', () => {
  expect(projectRadio(menuContext()).options.map((option) => option.label)).toEqual([
    'repo',
    'web — work',
  ])
})

test('picking a project opens that root', () => {
  const opened: string[] = []
  const select = projectRadio(menuContext({ selectProject: (path) => opened.push(path) })).select
  expect(select).toBeTypeOf('function')
  select?.('/work/web')

  expect(opened).toEqual(['/work/web'])
})

test('with no workspace open the project radio checks nothing', () => {
  expect(projectRadio(menuContext({ workspacePath: null })).value).toBe('')
})

test('the ui mode radio offers both modes and checks the active one', () => {
  const group = radioGroup(menuContext({ uiMode: 'chat' }), 'view', 'uiMode')

  expect(group.value).toBe('workspace.showChatMode')
  expect(group.options.map((option) => option.label)).toEqual(['Workbench Mode', 'Chat Mode'])
  expect(group.options.map((option) => option.command)).toEqual([
    'workspace.showWorkbenchMode',
    'workspace.showChatMode',
  ])
  expect(group.select).toBeUndefined()
})

test('the color mode submenu offers light, dark, and system', () => {
  const group = colorModeRadio(menuContext())

  expect(group.options.map((option) => option.label)).toEqual(['Light', 'Dark', 'System'])
  expect(group.options.map((option) => option.command)).toEqual([
    'workspace.setLightTheme',
    'workspace.setDarkTheme',
    'workspace.setSystemTheme',
  ])
})

test('the color mode radio checks the current theme', () => {
  expect(colorModeRadio(menuContext({ colorMode: 'dark' })).value).toBe('workspace.setDarkTheme')
  expect(colorModeRadio(menuContext({ colorMode: 'light' })).value).toBe('workspace.setLightTheme')
  expect(colorModeRadio(menuContext({ colorMode: 'system' })).value).toBe(
    'workspace.setSystemTheme',
  )
})

test('Copy Workspace Path is disabled with no workspace open', () => {
  expect(copyItem(menuContext({ workspacePath: null })).disabled).toBe(true)
  expect(copyItem(menuContext()).disabled).toBe(false)
})

test('Copy Workspace Path copies through the injected callback', () => {
  let copied = 0
  copyItem(menuContext({ copyWorkspacePath: () => (copied += 1) })).run()

  expect(copied).toBe(1)
})

function items(context: TitlebarMenuContext, sectionId: string): readonly MenuItem[] {
  const entry = titlebarMenu(context).find((candidate) => candidate.id === sectionId)

  return (entry?.items ?? []).filter((item): item is MenuItem => Boolean(item))
}

/** Radio groups have no label of their own, so they report their checked value. */
function labels(context: TitlebarMenuContext, sectionId: string) {
  return items(context, sectionId).map((item) =>
    item.kind === 'radio-group' ? item.value : item.label,
  )
}

function radioGroup(
  context: TitlebarMenuContext,
  sectionId: string,
  itemId: string,
): MenuRadioGroupItem {
  const found = items(context, sectionId).find(
    (item) => item.kind === 'radio-group' && item.id === itemId,
  )
  expect(found?.kind).toBe('radio-group')

  return found as MenuRadioGroupItem
}

function submenu(context: TitlebarMenuContext, sectionId: string, itemId: string) {
  const found = items(context, sectionId).find(
    (item) => item.kind === 'submenu' && item.id === itemId,
  )
  expect(found?.kind).toBe('submenu')

  return found as MenuSubmenuItem
}

function submenuRadio(entry: MenuSubmenuItem): MenuRadioGroupItem {
  const found = entry.sections
    .flatMap((part) => part.items)
    .find((item) => item && item.kind === 'radio-group')
  expect(found).toBeTruthy()

  return found as MenuRadioGroupItem
}

function projectRadio(context: TitlebarMenuContext) {
  return submenuRadio(submenu(context, 'project', 'switchProject'))
}

function colorModeRadio(context: TitlebarMenuContext) {
  return submenuRadio(submenu(context, 'view', 'colorMode'))
}

function copyItem(context: TitlebarMenuContext) {
  const found = items(context, 'copy').find((item) => item.kind === 'action')
  expect(found?.kind).toBe('action')

  return found as Extract<MenuItem, { kind: 'action' }>
}

function menuContext(overrides: Partial<TitlebarMenuContext> = {}): TitlebarMenuContext {
  return {
    colorMode: 'system',
    copyWorkspacePath: () => {},
    projects,
    selectProject: () => {},
    uiMode: 'workbench',
    workspacePath: '/repo',
    ...overrides,
  }
}
