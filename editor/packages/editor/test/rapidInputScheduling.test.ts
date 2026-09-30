import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Editor } from '../src/editor'
import {
  EditorSecondaryWorkScheduler,
  type EditorSecondaryWorkOptions,
} from '../src/editor/secondaryWorkScheduler'
import { resetEditorInstanceCount } from '../src/public/testing'

/**
 * Rapid input defers syntax and feature work behind a debounce. A sustained
 * typing run never leaves that gap, so the deferral has to carry a ceiling or
 * the editor stops re-tokenizing entirely until the user pauses. These assert
 * the wiring, not the scheduler primitive — see secondaryWorkScheduler.test.ts
 * for the primitive.
 */
describe('rapid input secondary work', () => {
  let container: HTMLElement
  let editor: Editor
  let scheduled: EditorSecondaryWorkOptions[]

  beforeEach(() => {
    scheduled = []
    vi.spyOn(EditorSecondaryWorkScheduler.prototype, 'schedule').mockImplementation((options) => {
      scheduled.push(options)
    })
    resetEditorInstanceCount()
    container = document.createElement('div')
    document.body.appendChild(container)
    editor = new Editor(container, { defaultText: 'abc' })
  })

  afterEach(() => {
    editor.dispose()
    container.remove()
    vi.restoreAllMocks()
  })

  it('bounds how long a typing burst can defer syntax and feature work', () => {
    const root = document.querySelector('.editor-virtualized') as HTMLElement
    root.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'x',
        inputType: 'insertText',
      }),
    )

    const deferred = new Map(scheduled.map((options) => [options.key, options]))

    // Whatever a keystroke defers, it defers under a ceiling: a sustained run
    // never leaves the debounce gap, so an uncapped key would never run at all.
    expect([...deferred.keys()]).toEqual(
      expect.arrayContaining(['editor.syntaxRefresh', 'editor.featureContributions']),
    )
    expect(deferred.size).toBeGreaterThanOrEqual(2)
    for (const options of deferred.values()) {
      expect(options.delayMs).toBeGreaterThan(0)
      expect(options.maxDelayMs).toBeGreaterThan(options.delayMs!)
    }
  })
  it('keeps a pending parse current when the user selects text after typing', () => {
    editor.getInputElement().dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'x',
        inputType: 'insertText',
      }),
    )
    const syntax = scheduled.find((work) => work.key === 'editor.syntaxRefresh')!
    expect(syntax.isCurrent?.(syntax.version!)).toBe(true)
    editor.setSelection(0, 2)
    expect(syntax.isCurrent?.(syntax.version!)).toBe(true)
    editor.getInputElement().dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'y',
        inputType: 'insertText',
      }),
    )
    expect(syntax.isCurrent?.(syntax.version!)).toBe(false)
  })
})
