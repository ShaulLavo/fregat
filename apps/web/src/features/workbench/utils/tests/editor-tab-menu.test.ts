import { filesystemPath, tabId } from '@/lib/documents/utils/identity'
import { testTabContent } from '../../../../../test/factories/document-targets'
import type { EditorTabCloseTarget } from '@/features/workspace/utils/tab-close-targets'
import type { EditorTabModel } from '@/features/workspace/utils/tab-types'
import type { MenuActionItem } from '@/keymap/menus/utils/model'
import {
  editorTabMenu,
  type EditorTabMenuContext,
} from '@/features/workbench/utils/editor-tab-menu'
import { iconForEntry } from '@/lib/file-icons'
import { expect, test } from '../../../../../test/fixtures'

test('the tab menu offers the close family, then the copy pair', () => {
  expect(sectionIds(menuContext())).toEqual(['close', 'copy'])
  expect(allLabels(menuContext())).toEqual([
    'Close',
    'Close Others',
    'Close to the Right',
    'Close Saved',
    'Close All',
    'Copy Path',
    'Copy Relative Path',
  ])
})

test('a diff tab can jump to the file it is comparing', () => {
  const opened: string[] = []
  const context = menuContext({
    openFile: (path) => opened.push(path),
    tab: diffTabModel({ onDisk: true }),
  })

  expect(sectionIds(context)).toEqual(['close', 'open', 'copy'])

  const openFile = byId(items(context), 'openFile')
  expect(openFile.disabled).toBe(false)
  openFile.run()

  expect(opened).toEqual(['/repo/src/b.ts'])
})

test('a diff of a deleted file has no file left to open', () => {
  const deleted = items(menuContext({ tab: diffTabModel({ onDisk: false }) }))

  expect(byId(deleted, 'openFile').disabled).toBe(true)
})

test('a lone clean tab keeps only the close actions that still mean something', () => {
  const only = items(menuContext({ closeTargets: [target('a')], tab: tabModel('a') }))

  expect(enabledIds(only)).toEqual([
    'close',
    'closeSaved',
    'closeAll',
    'copyPath',
    'copyRelativePath',
  ])
})

test('the last tab has nothing to its right but still has others to close', () => {
  const last = items(menuContext({ tab: tabModel('c') }))

  expect(byId(last, 'closeToRight').disabled).toBe(true)
  expect(byId(last, 'closeOthers').disabled).toBe(false)
})

test('Close Saved is disabled once every open tab is dirty', () => {
  const dirty = [target('a', true), target('b', true), target('c', true)]

  expect(byId(items(menuContext({ closeTargets: dirty })), 'closeSaved').disabled).toBe(true)
})

test('a tab the close targets do not know about disables the whole close section', () => {
  const orphan = items(menuContext({ tab: tabModel('missing') }))

  expect(orphan.filter((item) => item.id.startsWith('close')).every((item) => item.disabled)).toBe(
    true,
  )
})

test('the copy items stay enabled for a tab that is no longer open', () => {
  const orphan = items(menuContext({ tab: tabModel('missing') }))

  expect(enabledIds(orphan)).toEqual(['copyPath', 'copyRelativePath'])
})

test('each close item asks for exactly the tabs its name promises', () => {
  const closed: string[][] = []
  const menu = items(menuContext({ closeTabs: (tabIds) => closed.push([...tabIds]) }))

  byId(menu, 'close').run()
  byId(menu, 'closeOthers').run()
  byId(menu, 'closeToRight').run()
  byId(menu, 'closeSaved').run()
  byId(menu, 'closeAll').run()

  expect(closed).toEqual([['b'], ['a', 'c'], ['c'], ['a', 'c'], ['a', 'b', 'c']])
})

test('the copy items pass the absolute path and the workspace-relative one', () => {
  const copied: [string, string][] = []
  const menu = items(menuContext({ copyPath: (path, label) => copied.push([path, label]) }))

  byId(menu, 'copyPath').run()
  byId(menu, 'copyRelativePath').run()

  expect(copied).toEqual([
    ['/repo/src/b.ts', 'path'],
    ['src/b.ts', 'relative path'],
  ])
})

function items(context: EditorTabMenuContext) {
  return editorTabMenu(context).flatMap((entry) => entry.items.filter(Boolean) as MenuActionItem[])
}

function allLabels(context: EditorTabMenuContext) {
  return items(context).map((item) => item.label)
}

/** Sections that survive resolution — an all-empty one is dropped before render. */
function sectionIds(context: EditorTabMenuContext) {
  return editorTabMenu(context)
    .filter((entry) => entry.items.some(Boolean))
    .map((entry) => entry.id)
}

function enabledIds(entries: readonly MenuActionItem[]) {
  return entries.filter((item) => !item.disabled).map((item) => item.id)
}

function byId(entries: readonly MenuActionItem[], id: string) {
  const item = entries.find((candidate) => candidate.id === id)

  expect(item, `menu item ${id}`).toBeDefined()

  return item as MenuActionItem
}

function target(id: string, dirty = false): EditorTabCloseTarget {
  return { dirty, id: tabId(id) }
}

function diffTabModel({ onDisk }: { onDisk: boolean }): EditorTabModel {
  return { ...tabModel('b'), diffSource: { onDisk, path: filesystemPath('/repo/src/b.ts') } }
}

function tabModel(id: string): EditorTabModel {
  return {
    active: id === 'b',
    copyPath: `/repo/src/${id}.ts`,
    copyRelativePath: `src/${id}.ts`,
    diffSource: null,
    diffStatus: null,
    diffSuffix: '',
    icon: iconForEntry({ name: `${id}.ts`, type: 'file' }),
    id: tabId(id),
    name: `${id}.ts`,
    content: testTabContent(`/repo/src/${id}.ts`),
    title: `src/${id}.ts`,
  }
}

/** Three open tabs, the middle one dirty and the one being right-clicked. */
function menuContext(overrides: Partial<EditorTabMenuContext> = {}): EditorTabMenuContext {
  return {
    closeTabs: () => {},
    closeTargets: [target('a'), target('b', true), target('c')],
    copyPath: () => {},
    openFile: () => {},
    tab: tabModel('b'),
    ...overrides,
  }
}
