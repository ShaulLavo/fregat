import { afterEach, expect, it, vi } from 'vitest'
import type {
  EditorInputCommandState,
  EditorTouchSelectionEvent,
  EditorViewContribution,
} from '@singapore-editor/core/extensions'
import {
  createTestPluginContext,
  createTestViewContributionContext,
} from '@singapore-editor/core/testing'
import { createTouchHaptics, createTouchSelectionPlugin } from '../src/touchSelectionPlugin'

const owned: { dispose(): void }[] = []
afterEach(() => {
  for (const entry of owned) entry.dispose()
  owned.length = 0
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

function touchFixture(haptics = false) {
  let listener: ((event: EditorTouchSelectionEvent) => void) | null = null
  let contribution: EditorViewContribution | null = null
  const state: { current: EditorInputCommandState } = {
    current: { editable: true, canUndo: false, canRedo: false },
  }
  const run = vi.fn()
  const context = createTestViewContributionContext({
    onDidTouchSelection: (next) => {
      listener = next
      return {
        dispose: () => {
          listener = null
        },
      }
    },
    getTouchSelectionAnchor: () => ({ x: 100, y: 100, bottom: 120 }),
    getSelectedText: () => 'bravo',
    getInputCommandState: () => state.current,
    runInputCommand: run,
  })
  createTouchSelectionPlugin({ haptics }).activate!(
    createTestPluginContext({
      registerViewContribution: (provider) => {
        contribution = provider.createContribution(context)
        return { dispose: () => undefined }
      },
    }),
  )
  owned.push({ dispose: () => contribution?.dispose() })
  const emit = (phase: EditorTouchSelectionEvent['phase'], head = 11) =>
    listener?.({
      phase,
      kind: phase === 'cancel' ? null : 'word',
      anchor: { x: 100, y: 100, bottom: 120 },
      selections: [
        { anchorOffset: 6, headOffset: head, startOffset: 6, endOffset: head, affinity: 'after' },
      ],
    })
  return { emit, run, state, context }
}

it('opens only after a settled gesture and disposes all owned chrome', () => {
  const fixture = touchFixture()
  fixture.emit('start')
  expect(document.querySelector('.editor-touch-menu')).toBeNull()
  fixture.emit('end')
  expect(document.querySelector('.editor-touch-menu')).not.toBeNull()
  fixture.emit('cancel')
  expect(document.querySelector('.editor-touch-menu')).toBeNull()
  owned[0]!.dispose()
  expect(document.querySelector('style[data-editor-touch-menu]')).toBeNull()
  fixture.emit('end')
  expect(document.querySelector('.editor-touch-menu')).toBeNull()
})

it('shows history actions from current command availability and uses the core command', async () => {
  const fixture = touchFixture()
  fixture.emit('end')
  expect(document.querySelector('[data-action="undo"]')).toBeNull()
  expect(document.querySelector('[data-action="redo"]')).toBeNull()
  fixture.state.current = { editable: true, canUndo: true, canRedo: false }
  fixture.emit('end')
  document.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click()
  expect(fixture.run).toHaveBeenCalledWith('undo')
  await Promise.resolve()
  fixture.state.current = { editable: true, canUndo: false, canRedo: true }
  fixture.emit('end')
  expect(document.querySelector('[data-action="undo"]')).toBeNull()
  document.querySelector<HTMLButtonElement>('[data-action="redo"]')!.click()
  expect(fixture.run).toHaveBeenLastCalledWith('redo')
  fixture.state.current = { editable: false, canUndo: true, canRedo: true }
  fixture.emit('end')
  expect(document.querySelector('[data-action="undo"]')).toBeNull()
  expect(document.querySelector('[data-action="redo"]')).toBeNull()
})

it('gives one supported tick per selection start, changed snap and menu appearance', () => {
  const vibrate = vi.fn(() => true)
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'vibrate')
  Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate })
  try {
    const fixture = touchFixture(true)
    fixture.emit('start')
    fixture.emit('update')
    fixture.emit('update', 19)
    fixture.emit('update', 19)
    fixture.emit('end', 19)
    expect(vibrate.mock.calls).toEqual([[8], [8], [8]])
    createTouchHaptics(fixture.context, false).tick()
    expect(vibrate).toHaveBeenCalledTimes(3)
  } finally {
    if (descriptor) Object.defineProperty(navigator, 'vibrate', descriptor)
    else Reflect.deleteProperty(navigator, 'vibrate')
  }
})
