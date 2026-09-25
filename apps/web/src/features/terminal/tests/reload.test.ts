import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { environmentIdSchema } from '@workspace/contracts'
import * as v from 'valibot'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import {
  captureTerminal,
  discardTerminal,
  prepareTerminalReload,
  savedTerminal,
  terminalReloadGeneration,
  TERMINAL_RELOAD_MAX_BYTES,
} from '@/features/terminal/state/reload'

function fixture() {
  const entries = new Map<string, string>()
  const storage: ScopedStorage = {
    environmentId: v.parse(environmentIdSchema, '00000000-0000-4000-8000-000000000085'),
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value)
      return 'written'
    },
    removeItem: (key) => {
      entries.delete(key)
    },
    keys: (prefix) => [...entries.keys()].filter((key) => key.startsWith(prefix)),
  }
  const owner = new QueryClient()
  prepareTerminalReload(owner, storage, '/repo')
  const target = {
    root: '/repo',
    sessionId: 'shell',
    fontSize: 14,
    fontFamily: 'monospace',
    paletteHash: 'dark',
  }
  return { owner, storage, entries, target }
}

describe('terminal display cache', () => {
  it('restores only matching identity and appearance without seeding live queries', () => {
    const { owner, storage, target } = fixture()
    captureTerminal(owner, target, 'native paint')
    const reloaded = new QueryClient()
    prepareTerminalReload(reloaded, storage, target.root)
    expect(savedTerminal(reloaded, target)).toBe('native paint')
    expect(reloaded.getQueryCache().getAll()).toHaveLength(0)
    expect(savedTerminal(reloaded, { ...target, sessionId: 'other' })).toBeNull()
    expect(savedTerminal(reloaded, { ...target, fontSize: 16 })).toBeNull()
    expect(savedTerminal(reloaded, { ...target, fontFamily: 'serif' })).toBeNull()
    expect(savedTerminal(reloaded, { ...target, paletteHash: 'light' })).toBeNull()
    prepareTerminalReload(reloaded, storage, '/different')
    expect(savedTerminal(reloaded, target)).toBeNull()
  })

  it('rejects outgoing generation flushes even when returning to the same root', () => {
    const { owner, storage, target } = fixture()
    const old = terminalReloadGeneration(owner)
    prepareTerminalReload(owner, storage, '/different')
    prepareTerminalReload(owner, storage, target.root)
    captureTerminal(owner, target, 'current')
    captureTerminal(owner, target, 'outgoing', old)
    expect(savedTerminal(owner, target)).toBe('current')
  })

  it('drops refused paint without deleting a newer capture', () => {
    const { owner, target } = fixture()
    captureTerminal(owner, target, 'new')
    discardTerminal(owner, target, 'old')
    expect(savedTerminal(owner, target)).toBe('new')
    discardTerminal(owner, target, 'new')
    expect(savedTerminal(owner, target)).toBeNull()
    captureTerminal(owner, target, 'safe')
    captureTerminal(owner, target, undefined)
    expect(savedTerminal(owner, target)).toBeNull()
  })

  it('rejects oversized persisted or captured display', () => {
    const { owner, storage, target } = fixture()
    captureTerminal(owner, target, 'x'.repeat(TERMINAL_RELOAD_MAX_BYTES))
    expect(savedTerminal(owner, target)).toBeNull()
    storage.setItem('terminal.display.v1', 'x'.repeat(TERMINAL_RELOAD_MAX_BYTES))
    prepareTerminalReload(owner, storage, target.root)
    expect(savedTerminal(owner, target)).toBeNull()
  })
})
