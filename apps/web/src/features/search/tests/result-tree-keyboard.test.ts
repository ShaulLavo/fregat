import { expect, test } from '../../../../test/fixtures'
import {
  searchKeyboardHarness,
  searchResultGroup,
  searchResultKeyEvent,
} from '../../../../test/factories/search-results'

const surfaces = ['editor'] as const

test.each(surfaces)('%s leaves modified navigation and Enter to other commands', () => {
  const harness = searchKeyboardHarness()
  for (const modifier of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey']) {
    for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter']) {
      const event = searchResultKeyEvent(key, { [modifier]: true })
      harness.press(event, harness.items[0]?.id ?? null)
      expect(event.defaultPrevented).toBe(false)
    }
  }
  expect(harness.actions).toEqual([])
})

test.each(surfaces)('%s navigates visible results and returns from a child to its parent', () => {
  const harness = searchKeyboardHarness()
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
})

test.each(surfaces)(
  '%s expands collapsed headers and collapses expanded headers with results',
  () => {
    const expanded = searchKeyboardHarness()
    const collapsed = searchKeyboardHarness([searchResultGroup({ collapsed: true })])
    const right = searchResultKeyEvent('ArrowRight')
    collapsed.press(right, collapsed.items[0]?.id ?? null)
    expect(right.defaultPrevented).toBe(true)
    expect(collapsed.actions).toEqual([['toggle', '/repo/src/app.ts']])
    expanded.press(searchResultKeyEvent('ArrowLeft'), expanded.items[0]?.id ?? null)
    expect(expanded.actions).toEqual([['toggle', '/repo/src/app.ts']])
  },
)

test('Enter opens the editor file', () => {
  const editor = searchKeyboardHarness()
  editor.press(searchResultKeyEvent('Enter'), editor.items[0]?.id ?? null)
  expect(editor.actions).toEqual([['open', { path: '/repo/src/app.ts', match: null }]])
})

test('ArrowLeft leaves an editor file with no excerpts expanded', () => {
  const editor = searchKeyboardHarness()
  const file = editor.blocks[0]
  expect(file).toBeDefined()
  if (!file) return
  editor.rows.splice(0, editor.rows.length, { type: 'file', file: { ...file, excerpts: [] } })
  editor.press(searchResultKeyEvent('ArrowLeft'), file.id)
  expect(editor.actions).toEqual([])
})
