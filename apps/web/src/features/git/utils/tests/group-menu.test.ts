import { groupMenu, type GroupMenuContext } from '@/features/git/utils/group-menu'
import type { MenuActionItem } from '@/keymap/menus/utils/model'
import { expect, test } from '../../../../../test/fixtures'

test('the worktree group offers open all diffs, stage all, then discard all', () => {
  expect(sectionIds(menuContext())).toEqual(['open', 'changes'])
  expect(allLabels(menuContext())).toEqual([
    'Open All Diffs',
    'Stage All Changes',
    'Discard All Changes',
  ])
})

test('the staged group offers unstage all instead of stage all', () => {
  expect(allLabels(menuContext({ section: 'staged' }))).toEqual([
    'Open All Diffs',
    'Unstage All Changes',
    'Discard All Staged Changes',
  ])
})

test('discard all is the only destructive item', () => {
  const destructive = items(menuContext()).filter((item) => item.destructive)

  expect(destructive.map((item) => item.id)).toEqual(['discardAll'])
})

test('every item dispatches — nothing is gated off', () => {
  expect(items(menuContext()).filter((item) => item.unavailable)).toEqual([])
  expect(items(menuContext()).every((item) => !item.disabled)).toBe(true)
})

test('each item runs the callback for its own group', () => {
  const calls: string[] = []
  const overrides = {
    discardAll: () => calls.push('discardAll'),
    openAllDiffs: () => calls.push('openAllDiffs'),
    stageAll: () => calls.push('stageAll'),
    unstageAll: () => calls.push('unstageAll'),
  }

  for (const item of items(menuContext(overrides))) item.run()
  for (const item of items(menuContext({ ...overrides, section: 'staged' }))) item.run()

  expect(calls).toEqual([
    'openAllDiffs',
    'stageAll',
    'discardAll',
    'openAllDiffs',
    'unstageAll',
    'discardAll',
  ])
})

function sectionIds(context: GroupMenuContext) {
  return groupMenu(context).map((entry) => entry.id)
}

function items(context: GroupMenuContext) {
  return groupMenu(context).flatMap((entry) => entry.items.filter(Boolean) as MenuActionItem[])
}

function allLabels(context: GroupMenuContext) {
  return items(context).map((item) => item.label)
}

function menuContext(overrides: Partial<GroupMenuContext> = {}): GroupMenuContext {
  return {
    discardAll: () => {},
    openAllDiffs: () => {},
    section: 'worktree',
    stageAll: () => {},
    unstageAll: () => {},
    ...overrides,
  }
}
