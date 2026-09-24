import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { WorkspaceSearchMatch } from '@workspace/contracts'
import { afterEach, beforeEach, describe } from 'vitest'

import { SearchFileMenu } from '@/features/search/components/file-menu'
import {
  SearchResultActionsContext,
  type SearchResultActions,
} from '@/features/search/providers/result-actions-context'
import type { WorkspaceSearchFileGroup } from '@/features/search/state/buffer-state'
import { searchFileMenu, searchItemMenuTarget } from '@/features/search/utils/file-menu'
import { searchResultItems } from '@/features/search/utils/result-items'
import type { SearchResultOpenTarget } from '@/features/search/utils/result-view-model'
import { pointAnchor } from '@/keymap/menus/utils/virtual-anchor'
import { stubClipboard, type ClipboardStub } from '../../../../test/factories/clipboard'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'

const MATCH: WorkspaceSearchMatch = {
  column: 7,
  endColumn: 13,
  kind: 'content',
  line: 12,
  path: 'work/repo/src/app.ts',
  preview: 'const needle = 1',
  source: 'disk',
  type: 'file',
}

const GROUP: WorkspaceSearchFileGroup = {
  collapsed: false,
  count: 1,
  matches: [MATCH],
  name: 'app.ts',
  path: 'work/repo/src/app.ts',
  pathLabel: 'src/app.ts',
}

function labels(target: SearchResultOpenTarget) {
  return searchFileMenu({ copyPath: () => {}, open: () => {}, relativePath: 'src/app.ts', target })
    .flatMap((section) => section.items)
    .flatMap((item) => (item && item.kind === 'action' ? [item.label] : []))
}

test('a match row adds Open Match ahead of the shared file actions', () => {
  expect(labels({ match: MATCH, path: MATCH.path })).toEqual([
    'Open Match',
    'Open File',
    'Copy Path',
    'Copy Relative Path',
  ])
})

test('a file heading offers the shared file actions only', () => {
  expect(labels({ match: null, path: GROUP.path })).toEqual([
    'Open File',
    'Copy Path',
    'Copy Relative Path',
  ])
})

test('each row type maps to its own target and the tree’s relative path', () => {
  const [group, match] = searchResultItems([GROUP])
  if (!group || !match) return expect.unreachable('expected a group and a match row')

  expect(searchItemMenuTarget(group, [GROUP])).toEqual({
    relativePath: 'src/app.ts',
    target: { match: null, path: GROUP.path },
  })
  expect(searchItemMenuTarget(match, [GROUP])).toEqual({
    relativePath: 'src/app.ts',
    target: { match: MATCH, path: MATCH.path },
  })
})

describe('the menu surface', () => {
  let clipboard: ClipboardStub
  let opened: SearchResultOpenTarget[]
  let user: ReturnType<typeof userEvent.setup>

  beforeEach(() => {
    user = userEvent.setup()
    clipboard = stubClipboard()
    opened = []
  })

  afterEach(() => clipboard.restore())

  function renderMenu(target: SearchResultOpenTarget) {
    const actions = {
      openTarget: (next: SearchResultOpenTarget) => opened.push(next),
    } as unknown as SearchResultActions
    renderWithProviders(
      <SearchResultActionsContext value={actions}>
        <SearchFileMenu
          anchor={pointAnchor(10, 10)}
          relativePath='src/app.ts'
          returnFocusTo={() => null}
          target={target}
          onOpenChange={() => {}}
        />
      </SearchResultActionsContext>,
    )
  }

  test('Open Match opens the exact line and column', async () => {
    renderMenu({ match: MATCH, path: MATCH.path })
    await user.click(await screen.findByRole('menuitem', { name: 'Open Match' }))

    expect(opened).toEqual([{ match: MATCH, path: MATCH.path }])
  })

  test('Open File opens the file without a location', async () => {
    renderMenu({ match: MATCH, path: MATCH.path })
    await user.click(await screen.findByRole('menuitem', { name: 'Open File' }))

    expect(opened).toEqual([{ match: null, path: MATCH.path }])
  })

  test('the copy items write the absolute and the relative path', async () => {
    renderMenu({ match: null, path: GROUP.path })
    await user.click(await screen.findByRole('menuitem', { name: 'Copy Relative Path' }))

    await expect.poll(() => clipboard.written.map((write) => write.text)).toEqual(['src/app.ts'])
  })
})
