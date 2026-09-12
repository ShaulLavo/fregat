import { fileMenu, type FileMenuContext } from '@/features/git/utils/file-menu'
import type { MenuActionItem } from '@/keymap/menus/utils/model'
import { expect, test } from '../../../../../test/fixtures'

test('a worktree row offers open, stage, discard, and copy in that order', () => {
  expect(sectionIds(menuContext())).toEqual(['open', 'stage', 'copy'])
  expect(allLabels(menuContext())).toEqual([
    'Open Changes',
    'Open File',
    'Stage Changes',
    'Discard Changes',
    'Copy Path',
    'Copy Relative Path',
  ])
})

test('a staged row swaps Stage for Unstage and names the discard for the index', () => {
  expect(labels(menuContext({ section: 'staged' }), 'stage')).toEqual([
    'Unstage Changes',
    'Discard Staged Changes',
  ])
})

test('a worktree row never offers Unstage', () => {
  expect(allLabels(menuContext())).not.toContain('Unstage Changes')
})

test('discard is the only destructive item', () => {
  const destructive = items(menuContext()).filter((item) => item.destructive)

  expect(destructive.map((item) => item.id)).toEqual(['discard'])
})

test('a deleted row cannot open the file', () => {
  expect(byId(items(menuContext({ onDisk: false })), 'openFile').disabled).toBe(true)
})

test('opening the diff dispatches instead of being gated off', () => {
  expect(items(menuContext()).filter((item) => item.unavailable)).toEqual([])
  expect(byId(items(menuContext()), 'openChanges').disabled).toBeFalsy()
})

test('an existing row can open the file', () => {
  expect(byId(items(menuContext()), 'openFile').disabled).toBe(false)
})

test('copy actions pass the absolute path and the relative path', () => {
  const copied: string[] = []
  const menu = items(menuContext({ copyPath: (value) => copied.push(value) }))

  byId(menu, 'copyPath').run()
  byId(menu, 'copyRelativePath').run()

  expect(copied).toEqual(['/repo/src/a.ts', 'src/a.ts'])
})

test('stage, unstage, and discard run their own callbacks', () => {
  const calls: string[] = []
  const overrides = {
    discard: () => calls.push('discard'),
    stage: () => calls.push('stage'),
    unstage: () => calls.push('unstage'),
  }

  byId(items(menuContext(overrides)), 'stage').run()
  byId(items(menuContext(overrides)), 'discard').run()
  byId(items(menuContext({ ...overrides, section: 'staged' })), 'unstage').run()

  expect(calls).toEqual(['stage', 'discard', 'unstage'])
})

function sectionIds(context: FileMenuContext) {
  return fileMenu(context).map((entry) => entry.id)
}

function items(context: FileMenuContext) {
  return fileMenu(context).flatMap((entry) => sectionItems(entry.items))
}

function labels(context: FileMenuContext, sectionId: string) {
  const entry = fileMenu(context).find((candidate) => candidate.id === sectionId)

  return sectionItems(entry?.items ?? []).map((item) => item.label)
}

function allLabels(context: FileMenuContext) {
  return items(context).map((item) => item.label)
}

function sectionItems(entries: ReturnType<typeof fileMenu>[number]['items']) {
  return entries.filter(Boolean) as MenuActionItem[]
}

function byId(entries: readonly MenuActionItem[], id: string) {
  const item = entries.find((candidate) => candidate.id === id)

  expect(item, `menu item ${id}`).toBeDefined()

  return item as MenuActionItem
}

function menuContext(overrides: Partial<FileMenuContext> = {}): FileMenuContext {
  return {
    copyPath: () => {},
    discard: () => {},
    onDisk: true,
    openDiff: () => {},
    openFile: () => {},
    path: '/repo/src/a.ts',
    relativePath: 'src/a.ts',
    section: 'worktree',
    stage: () => {},
    unstage: () => {},
    ...overrides,
  }
}
