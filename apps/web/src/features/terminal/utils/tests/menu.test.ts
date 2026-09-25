import type { MenuActionItem } from '@/keymap/menus/utils/model'
import { terminalMenu, type TerminalMenuContext } from '@/features/terminal/utils/menu'
import { expect, test } from '../../../../../test/fixtures'

test('sections run agent, clipboard, screen, scroll, then renderer', () => {
  const ids = terminalMenu(menuContext({ hasScrollback: true })).map((entry) => entry.id)

  expect(ids).toEqual(['agent', 'clipboard', 'screen', 'scroll', 'renderer'])
})

test('Ask the Agent is disabled until the capture survives normalization', () => {
  // Keyed on the normalized capture, not on `hasSelection`: a drag that caught
  // only whitespace is a selection the terminal reports and the agent cannot use.
  expect(item(menuContext({ canAskAgent: false, hasSelection: true }), 'askAgent').disabled).toBe(
    true,
  )
  expect(item(menuContext({ canAskAgent: true, hasSelection: true }), 'askAgent').disabled).toBe(
    false,
  )
})

test('the clipboard section reads Copy, Paste, Select All', () => {
  expect(labels(menuContext(), 'clipboard')).toEqual(['Copy', 'Paste', 'Select All'])
})

test('Copy is disabled with nothing selected', () => {
  expect(item(menuContext({ hasSelection: false }), 'copy').disabled).toBe(true)
  expect(item(menuContext({ hasSelection: true }), 'copy').disabled).toBe(false)
})

test('Select All stays enabled with nothing selected', () => {
  expect(item(menuContext({ hasSelection: false }), 'selectAll').disabled).toBeFalsy()
})

test('Paste offers its shortcut when the clipboard can be read', () => {
  const paste = item(menuContext({ pasteBlocked: false }), 'paste')

  expect(paste.unavailable).toBeUndefined()
  expect(paste.shortcut).toBeTruthy()
})

test('a blocked Paste is unavailable, and says which key still works', () => {
  const paste = item(menuContext({ pasteBlocked: true }), 'paste')

  // `unavailable` is what disables the item and fills the trailing slot, so the
  // hint has to be the shortcut itself rather than a "soon" style excuse.
  expect(paste.unavailable).toBe(paste.shortcut)
  expect(paste.unavailable).toBeTruthy()
})

test('the screen section separates clear, viewer reset and process restart', () => {
  expect(labels(menuContext(), 'screen')).toEqual(['Clear', 'Reset', 'Restart shell'])
})

test('Reset is destructive and Clear is not', () => {
  expect(item(menuContext(), 'reset').destructive).toBe(true)
  expect(item(menuContext(), 'clear').destructive).toBeFalsy()
})

test('shared history Clear does not advertise the shell repaint shortcut', () => {
  expect(item(menuContext(), 'clear').shortcut).toBeUndefined()
})

test('a terminal with no scrollback offers no scroll items', () => {
  // The section survives as an empty one; `resolveMenu` drops it before render,
  // which is what keeps a dangling separator off the bottom of the menu.
  expect(labels(menuContext({ hasScrollback: false }), 'scroll')).toEqual([])
})

test('scrollback adds Scroll to Top and Scroll to Bottom', () => {
  expect(labels(menuContext({ hasScrollback: true }), 'scroll')).toEqual([
    'Scroll to Top',
    'Scroll to Bottom',
  ])
})

test('every item runs the callback it was built from', () => {
  const ran: string[] = []
  const context = menuContext({ canAskAgent: true, hasScrollback: true, hasSelection: true })
  const spied = Object.fromEntries(
    Object.entries(context).map(([key, value]) =>
      typeof value === 'function' ? [key, () => ran.push(key)] : [key, value],
    ),
  ) as TerminalMenuContext

  for (const entry of terminalMenu(spied)) {
    for (const candidate of entry.items) {
      if (!candidate) continue

      ;(candidate as MenuActionItem).run()
    }
  }

  expect(ran).toEqual([
    'askAgent',
    'copySelection',
    'paste',
    'selectAll',
    'clear',
    'reset',
    'restart',
    'scrollToTop',
    'scrollToBottom',
  ])
})

function actionItems(context: TerminalMenuContext, sectionId: string) {
  const entry = terminalMenu(context).find((candidate) => candidate.id === sectionId)

  return (entry?.items ?? []).filter(Boolean) as MenuActionItem[]
}

function labels(context: TerminalMenuContext, sectionId: string) {
  return actionItems(context, sectionId).map((entry) => entry.label)
}

function item(context: TerminalMenuContext, id: string) {
  const found = terminalMenu(context)
    .flatMap((entry) => entry.items)
    .filter(Boolean)
    .find((candidate) => (candidate as MenuActionItem).id === id)

  expect(found).toBeDefined()

  return found as MenuActionItem
}

function menuContext({
  canAskAgent = false,
  hasScrollback = false,
  hasSelection = false,
  pasteBlocked = false,
}: {
  canAskAgent?: boolean
  hasScrollback?: boolean
  hasSelection?: boolean
  pasteBlocked?: boolean
} = {}): TerminalMenuContext {
  return {
    askAgent: () => {},
    canAskAgent,
    clear: () => {},
    restart: () => {},
    copySelection: () => {},
    hasScrollback,
    hasSelection,
    paste: () => {},
    pasteBlocked,
    rendererBackend: 'webgpu',
    reset: () => {},
    scrollToBottom: () => {},
    scrollToTop: () => {},
    selectAll: () => {},
  }
}
