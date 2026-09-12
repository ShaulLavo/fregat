import { expect, test } from '../../../../test/fixtures'
import {
  searchKeyboardHarness,
  searchResultGroup,
  searchResultKeyEvent,
} from '../../../../test/factories/search-results'

const surfaces = ['sidebar', 'editor'] as const

test.each(surfaces)('%s leaves modified navigation and Enter to other commands', (surface) => {
  const harness = searchKeyboardHarness(surface)
  for (const modifier of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey']) {
    for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter']) {
      const event = searchResultKeyEvent(key, { [modifier]: true })
      harness.press(event, harness.items[0]?.id ?? null)
      expect(event.defaultPrevented).toBe(false)
    }
  }
  expect(harness.actions).toEqual([])
})

test.each(surfaces)(
  '%s navigates visible results and returns from a child to its parent',
  (surface) => {
    const harness = searchKeyboardHarness(surface)
    const groupId = harness.items[0]?.id ?? null
    const childId = harness.items[1]?.id ?? null
    expect(childId).not.toBeNull()
    harness.press(searchResultKeyEvent('ArrowDown'), null)
    harness.press(searchResultKeyEvent('ArrowDown'), groupId)
    harness.press(searchResultKeyEvent('ArrowUp'), childId)
    harness.press(searchResultKeyEvent('End'), groupId)
    harness.press(searchResultKeyEvent('Home'), childId)
    harness.press(searchResultKeyEvent('ArrowLeft'), childId)
    expect(harness.actions).toEqual([
      ['select', groupId],
      ['select', childId],
      ['select', groupId],
      ['select', childId],
      ['select', groupId],
      ['select', groupId],
    ])
  },
)

test.each(surfaces)(
  '%s expands collapsed headers and collapses expanded headers with results',
  (surface) => {
    const expanded = searchKeyboardHarness(surface)
    const collapsed = searchKeyboardHarness(surface, [searchResultGroup({ collapsed: true })])
    const right = searchResultKeyEvent('ArrowRight')
    collapsed.press(right, collapsed.items[0]?.id ?? null)
    expect(right.defaultPrevented).toBe(true)
    expect(collapsed.actions).toEqual([['toggle', '/repo/src/app.ts']])
    expanded.press(searchResultKeyEvent('ArrowLeft'), expanded.items[0]?.id ?? null)
    expect(expanded.actions).toEqual([['toggle', '/repo/src/app.ts']])
  },
)

test('Enter toggles the sidebar header and opens the editor file', () => {
  const sidebar = searchKeyboardHarness('sidebar')
  const editor = searchKeyboardHarness('editor')
  sidebar.press(searchResultKeyEvent('Enter'), sidebar.items[0]?.id ?? null)
  editor.press(searchResultKeyEvent('Enter'), editor.items[0]?.id ?? null)
  expect(sidebar.actions).toEqual([['toggle', '/repo/src/app.ts']])
  expect(editor.actions).toEqual([['open', { path: '/repo/src/app.ts', match: null }]])
})

test('ArrowLeft collapses an empty sidebar group while the empty editor file stays expanded', () => {
  const sidebar = searchKeyboardHarness('sidebar')
  const editor = searchKeyboardHarness('editor')
  const emptyGroup = searchResultGroup({ count: 0, matches: [] })
  const groupId = sidebar.items[0]?.id ?? ''
  sidebar.items.splice(0, sidebar.items.length, {
    type: 'group',
    id: groupId,
    level: 1,
    pending: false,
    group: emptyGroup,
  })
  const file = editor.blocks[0]
  expect(file).toBeDefined()
  if (!file) return
  editor.rows.splice(0, editor.rows.length, { type: 'file', file: { ...file, excerpts: [] } })
  sidebar.press(searchResultKeyEvent('ArrowLeft'), groupId)
  editor.press(searchResultKeyEvent('ArrowLeft'), file.id)
  expect(sidebar.actions).toEqual([['toggle', '/repo/src/app.ts']])
  expect(editor.actions).toEqual([])
})

test('ArrowRight uses each view model child lookup and falls back to its header id', () => {
  const sidebar = searchKeyboardHarness('sidebar')
  const editor = searchKeyboardHarness('editor')
  const groupId = sidebar.items[0]?.id ?? null
  const childId = sidebar.items[1]?.id ?? null
  expect(childId).not.toBeNull()
  editor.rows.reverse()
  sidebar.press(searchResultKeyEvent('ArrowRight'), groupId)
  editor.press(searchResultKeyEvent('ArrowRight'), groupId)
  expect(sidebar.actions).toEqual([['select', childId]])
  expect(editor.actions).toEqual([['select', childId]])
  sidebar.items.splice(1)
  const file = editor.blocks[0]
  expect(file).toBeDefined()
  if (!file) return
  editor.rows.splice(0, editor.rows.length, { type: 'file', file: { ...file, excerpts: [] } })
  sidebar.press(searchResultKeyEvent('ArrowRight'), groupId)
  editor.press(searchResultKeyEvent('ArrowRight'), groupId)
  expect(sidebar.actions.at(-1)).toEqual(['select', groupId])
  expect(editor.actions.at(-1)).toEqual(['select', file.id])
})
