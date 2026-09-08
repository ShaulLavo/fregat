import { vi } from 'vitest'
import { effectiveTerminalBindings } from '@/commands/utils/bindings'
import { createCommandHarness } from '../../../test/commands'
import { expect, test } from '../../../test/fixtures'

test('embedded terminal owns shell controls while Platform chords remain available', () => {
  const harness = createCommandHarness({
    area: 'terminal',
    textEntry: true,
    handlers: {
      'workspace.quit': { run: () => {} },
      'workspace.suspend': { run: () => {} },
      'workspace.focusNextPane': { run: () => {} },
      'workspace.dismiss': { run: () => {} },
      'workspace.reconnect': { run: () => {} },
      'workspace.showCommandPalette': { run: () => {} },
    },
  })
  try {
    for (const sequence of ['\x03', '\x1a', '\t', '\x1b', '\x12'])
      expect(harness.key(sequence)).toBe(false)
    expect(harness.key('\x0b')).toBe(true)
    expect(harness.key('q')).toBe(true)
    expect(harness.executed).toEqual(['workspace.quit'])
  } finally {
    harness.dispose()
  }
})

test('Control chords work in text entry and Escape cancels before dismissing', () => {
  const actions: string[] = []
  const harness = createCommandHarness({
    textEntry: true,
    handlers: {
      'workspace.showSettings': {
        run: () => {
          actions.push('settings')
        },
      },
      'workspace.dismiss': {
        run: () => {
          actions.push('dismiss')
        },
      },
    },
  })
  try {
    expect(harness.key('\x0b')).toBe(true)
    expect(harness.state.pending?.commands.map((command) => command.command)).toContain(
      'workspace.showSettings',
    )
    expect(harness.key('\x1b')).toBe(true)
    expect(actions).toEqual([])
    expect(harness.key('\x0b')).toBe(true)
    expect(harness.key('s')).toBe(true)
    expect(actions).toEqual(['settings'])
    expect(harness.state.pending).toBeNull()
    expect(harness.key('\x1b')).toBe(true)
    expect(actions).toEqual(['settings', 'dismiss'])
  } finally {
    harness.dispose()
  }
})

test('text entry keeps printable keys, pane bindings lead globals, and declining handlers fall through', () => {
  const actions: string[] = []
  const harness = createCommandHarness({
    textEntry: true,
    handlers: {
      'workspace.showShortcutHelp': {
        run: () => {
          actions.push('help')
        },
      },
      'settings.edit': { run: () => false },
      'workspace.showSettings': {
        run: () => {
          actions.push('settings')
        },
      },
    },
    bindings: [
      { command: 'workspace.showShortcutHelp', keys: '?', source: 'default' },
      { command: 'workspace.showSettings', keys: 'F2', source: 'default' },
      { command: 'settings.edit', keys: 'F2', pane: 'settings', source: 'default' },
    ],
  })
  try {
    expect(harness.key('?')).toBe(false)
    expect(harness.key('\x1bOQ')).toBe(true)
    expect(actions).toEqual(['settings'])
  } finally {
    harness.dispose()
  }
})

test('unavailable prefixes leave input alone and disabled short bindings retain longer alternatives', () => {
  const harness = createCommandHarness({
    handlers: {
      'workspace.showSettings': { run: () => undefined },
      'workspace.showCommandPalette': {
        disabledReason: () => 'Unavailable here.',
        run: () => false,
      },
    },
    bindings: [
      { command: 'workspace.showCommandPalette', keys: 'Ctrl+K', source: 'default' },
      { command: 'workspace.showSettings', keys: 'Ctrl+K s', source: 'default' },
      { command: 'workspace.navigateBack', keys: 'Ctrl+B b', source: 'default' },
    ],
  })
  try {
    expect(harness.key('\x02')).toBe(false)
    expect(harness.key('\x0b')).toBe(true)
    expect(harness.key('s')).toBe(true)
    expect(harness.executed).toEqual(['workspace.showSettings'])
  } finally {
    harness.dispose()
  }
})

test('focus changes and timeout cancel chords without swallowing later text', () => {
  vi.useFakeTimers()
  const harness = createCommandHarness({
    handlers: { 'workspace.showSettings': { run: () => undefined } },
  })
  try {
    harness.key('\x0b')
    vi.advanceTimersByTime(5_001)
    expect(harness.state.pending).toBeNull()
    expect(harness.key('s')).toBe(false)
    harness.key('\x0b')
    harness.focus.setScope({ ...harness.scope, environmentId: 'environment-b' })
    expect(harness.state.pending).toBeNull()
    expect(harness.key('s')).toBe(false)
  } finally {
    harness.dispose()
    vi.useRealTimers()
  }
})

test('Kitty release events do not invoke commands and legacy Alt is not desktop Meta', () => {
  const harness = createCommandHarness({
    handlers: { 'workspace.showSettings': { run: () => undefined } },
    bindings: [{ command: 'workspace.showSettings', keys: 'Alt+S', source: 'user' }],
  })
  try {
    expect(harness.key('\x1bs')).toBe(true)
    expect(harness.key('\x1b[115;3:3u', true)).toBe(false)
    expect(harness.executed).toEqual(['workspace.showSettings'])
  } finally {
    harness.dispose()
  }
})

test('overrides resolve Mod as Control, retain scope, unbind, and reject ambiguous keys', () => {
  const resolution = effectiveTerminalBindings({
    'workspace.showSettings': 'Mod+K e',
    'workspace.showQuickAccess': null,
    'settings.edit': 'F7',
    'workspace.copyAddress': 'Ctrl+S',
    'workspace.openAddress': 'Ctrl+C',
    missing: 'F8',
  })
  expect(resolution.bindings).toContainEqual({
    command: 'workspace.showSettings',
    keys: 'Ctrl+K E',
    source: 'user',
    pane: 'any',
  })
  expect(resolution.bindings).toContainEqual({
    command: 'settings.edit',
    keys: 'F7',
    source: 'user',
    pane: 'settings',
  })
  expect(
    resolution.bindings.some((binding) => binding.command === 'workspace.showQuickAccess'),
  ).toBe(false)
  expect(resolution.diagnostics.map((entry) => entry.command)).toEqual([
    'workspace.copyAddress',
    'workspace.openAddress',
    'missing',
    'workspace.focusFileTree',
  ])
})

test('an override replaces a matching chord but keeps an alternative shortcut', () => {
  const { bindings } = effectiveTerminalBindings({ 'workspace.showSettings': 'Control+K p' })
  const palette = bindings.filter((binding) => binding.command === 'workspace.showCommandPalette')
  expect(palette.map((binding) => binding.keys)).toEqual(['F1'])
})

test('Kitty shifted punctuation invokes the same help command as a legacy printable question mark', () => {
  const harness = createCommandHarness({
    handlers: { 'workspace.showShortcutHelp': { run: () => undefined } },
  })
  try {
    expect(harness.key('?', false)).toBe(true)
    expect(harness.key('\x1b[63;2u', true)).toBe(true)
    expect(harness.executed).toEqual(['workspace.showShortcutHelp', 'workspace.showShortcutHelp'])
  } finally {
    harness.dispose()
  }
})

test('shortcut recording owns input until its matching capture is released', () => {
  const recorded: string[] = []
  const harness = createCommandHarness({
    handlers: { 'workspace.showSettings': { run: () => undefined } },
  })
  try {
    harness.key('\x0b')
    const release = harness.keymap.captureKeys((event) => recorded.push(event.name))
    expect(harness.state.pending).toBeNull()
    expect(harness.key('\x0b')).toBe(true)
    expect(harness.key('s')).toBe(true)
    expect(harness.key('\x1b')).toBe(true)
    expect(recorded).toEqual(['k', 's', 'escape'])
    expect(harness.executed).toEqual([])
    const nextRelease = harness.keymap.captureKeys(() => recorded.push('next'))
    release()
    harness.key('s')
    expect(recorded.at(-1)).toBe('next')
    nextRelease()
    harness.key('\x0b')
    harness.key('s')
    expect(harness.executed).toEqual(['workspace.showSettings'])
  } finally {
    harness.dispose()
  }
})
