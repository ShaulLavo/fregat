import type { MenuRadioGroupItem } from '@/keymap/menus/utils/model'
import {
  isWorkbenchSidebarView,
  paneHeaderMenu,
  type PaneHeaderMenuContext,
} from '@/features/workbench/utils/pane-header-menu'
import { expect, test } from '../../../../../test/fixtures'

test('the chat tool pane lists every tool tab in rail order', () => {
  const group = viewGroup(menuContext())

  expect(group.options.map((option) => option.label)).toEqual([
    'Git',
    'Files',
    'Editor',
    'Search',
    'Terminal',
    'Problems',
    'Logs',
  ])
})

test('the workbench sidebar lists the views that sidebar can host', () => {
  const group = viewGroup(menuContext({ activeView: 'files', host: 'workbench-sidebar' }))

  expect(group.options.map((option) => option.value)).toEqual([
    'files',
    'git',
    'search',
    'logs',
    'chat',
  ])
})

test('the pane view is the checked radio value', () => {
  expect(viewGroup(menuContext({ activeView: 'terminal' })).value).toBe('terminal')
})

test('choosing a view hands the raw value to the host', () => {
  const chosen: string[] = []
  viewGroup(menuContext({ selectView: (value) => chosen.push(value) })).select?.('problems')

  expect(chosen).toEqual(['problems'])
})

test('the chat tool pane offers Hide, named after the pane', () => {
  expect(itemLabels(menuContext({ title: 'Source Control' }), 'pane')).toEqual([
    'Hide Source Control',
  ])
})

test('Hide runs the callback the host supplied', () => {
  let hidden = 0
  function hidePane() {
    hidden += 1
  }

  const menu = paneHeaderMenu(menuContext({ hidePane }))
  const hide = menu.find((entry) => entry.id === 'pane')?.items[0]

  if (!hide || hide.kind !== 'action') throw new Error('expected a hide action')
  hide.run()

  expect(hidden).toBe(1)
})

test('the workbench sidebar drops the pane section instead of promising a Hide', () => {
  const context = menuContext({ hidePane: null, host: 'workbench-sidebar' })

  expect(itemLabels(context, 'pane')).toEqual([])
})

test('only the sidebar views narrow back to a sidebar tab', () => {
  expect(isWorkbenchSidebarView('git')).toBe(true)
  expect(isWorkbenchSidebarView('terminal')).toBe(false)
})

function viewGroup(context: PaneHeaderMenuContext): MenuRadioGroupItem {
  const item = paneHeaderMenu(context).find((entry) => entry.id === 'view')?.items[0]
  if (!item || item.kind !== 'radio-group') throw new Error('expected a view radio group')

  return item
}

function itemLabels(context: PaneHeaderMenuContext, sectionId: string) {
  const entry = paneHeaderMenu(context).find((candidate) => candidate.id === sectionId)

  return (entry?.items ?? []).filter(Boolean).map((item) => (item as { label: string }).label)
}

function menuContext(overrides: Partial<PaneHeaderMenuContext> = {}): PaneHeaderMenuContext {
  return {
    activeView: 'git',
    hidePane: () => {},
    host: 'chat-pane',
    selectView: () => {},
    title: 'Files',
    ...overrides,
  }
}
