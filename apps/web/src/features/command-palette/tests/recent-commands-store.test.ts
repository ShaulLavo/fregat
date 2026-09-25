import { afterEach, beforeEach, vi } from 'vitest'

import { expect, test } from '../../../../test/fixtures'
import {
  recentCommandIds,
  recordCommandUse,
  resetRecentCommandsStore,
  subscribeRecentCommands,
} from '@/features/command-palette/state/recent-commands-store'

const RECENT_COMMANDS_STORAGE_KEY = 'platform.command-palette.recent-commands.v1'

// The node project has no DOM, and what these tests are about is what crosses
// localStorage, so stand up a real Map-backed Storage rather than skipping it.
const STORE = new Map<string, string>()

function memoryLocalStorage(): Storage {
  return {
    get length() {
      return STORE.size
    },
    clear: () => STORE.clear(),
    getItem: (key: string) => STORE.get(key) ?? null,
    key: (index: number) => Array.from(STORE.keys())[index] ?? null,
    removeItem: (key: string) => void STORE.delete(key),
    setItem: (key: string, value: string) => void STORE.set(key, value),
  }
}

beforeEach(() => {
  STORE.clear()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: memoryLocalStorage(),
  })
  resetRecentCommandsStore()
})

afterEach(() => {
  STORE.clear()
  resetRecentCommandsStore()
  delete (globalThis as { localStorage?: Storage }).localStorage
})

test('starts empty', () => {
  expect(recentCommandIds()).toEqual([])
})

test('puts the most recently used command first', () => {
  recordCommandUse('workspace.toggleSidebarVisibility')
  recordCommandUse('workspace.revealTerminal')

  expect(recentCommandIds()).toEqual([
    'workspace.revealTerminal',
    'workspace.toggleSidebarVisibility',
  ])
})

test('re-running a command moves it up instead of duplicating it', () => {
  recordCommandUse('workspace.toggleSidebarVisibility')
  recordCommandUse('workspace.revealTerminal')
  recordCommandUse('workspace.toggleSidebarVisibility')

  expect(recentCommandIds()).toEqual([
    'workspace.toggleSidebarVisibility',
    'workspace.revealTerminal',
  ])
})

test('survives a reload through localStorage', () => {
  recordCommandUse('workspace.toggleSidebarVisibility')

  // What a fresh page load does: drop the in-memory list, read storage back.
  resetRecentCommandsStore()

  expect(recentCommandIds()).toEqual(['workspace.toggleSidebarVisibility'])
})

test('drops malformed storage instead of trusting it', () => {
  localStorage.setItem(RECENT_COMMANDS_STORAGE_KEY, '{not json')
  resetRecentCommandsStore()

  expect(recentCommandIds()).toEqual([])
})

test('drops storage written under a different version', () => {
  localStorage.setItem(
    RECENT_COMMANDS_STORAGE_KEY,
    JSON.stringify({ commandIds: ['workspace.toggleSidebarVisibility'], version: 99 }),
  )
  resetRecentCommandsStore()

  expect(recentCommandIds()).toEqual([])
})

test('returns a stable reference until something changes', () => {
  // useSyncExternalStore re-renders forever if every read is a new array.
  recordCommandUse('workspace.toggleSidebarVisibility')

  expect(recentCommandIds()).toBe(recentCommandIds())
})

test('notifies subscribers, and not for a repeat of the current head', () => {
  const listener = vi.fn()
  subscribeRecentCommands(listener)

  recordCommandUse('workspace.toggleSidebarVisibility')
  expect(listener).toHaveBeenCalledTimes(1)

  recordCommandUse('workspace.toggleSidebarVisibility')
  expect(listener).toHaveBeenCalledTimes(1)
})

test('keeps multiple recent commands when browser storage is unavailable', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('Storage disabled')
    },
  })
  recordCommandUse('workspace.toggleSidebarVisibility')
  recordCommandUse('workspace.revealTerminal')
  expect(recentCommandIds()).toEqual([
    'workspace.revealTerminal',
    'workspace.toggleSidebarVisibility',
  ])
})

test('keeps the session history when later storage writes fail', () => {
  recordCommandUse('workspace.toggleSidebarVisibility')
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw new Error('Storage full')
  })
  recordCommandUse('workspace.revealTerminal')
  recordCommandUse('workspace.toggleSidebarVisibility')
  expect(recentCommandIds()).toEqual([
    'workspace.toggleSidebarVisibility',
    'workspace.revealTerminal',
  ])
})
