import { afterEach, describe, expect, it } from 'vitest'

import { createRenameWidgetController } from '../src/renameWidget'

describe('the rename input', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  // Renaming while a rename is open is one keystroke away — the command is on a key — and the second
  // prompt is the one the reader is waiting on: dismissing the first must not take the field with it.
  it('stays on screen when a second rename is asked for while one is open', async () => {
    const controller = createRenameWidgetController({ document, themeSource: document.body })
    const anchor = new DOMRect(10, 20, 40, 18)
    const firstAbort = new AbortController()
    const secondAbort = new AbortController()

    const first = controller.prompt({ anchor, currentName: 'first', signal: firstAbort.signal })
    const second = controller.prompt({ anchor, currentName: 'second', signal: secondAbort.signal })

    await expect(first).resolves.toBeNull()
    expect(renameElement().style.display).toBe('block')
    // The surface the field is placed against goes with it, or the field lands wherever it was last.
    expect(renameAnchorElement().style.display).toBe('block')

    renameInput().value = 'renamed'
    renameInput().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    )

    await expect(second).resolves.toBe('renamed')
    controller.dispose()
  })

  it('gives focus back to the editor when Escape or Enter closes it, not after a click away', async () => {
    const editor = document.createElement('textarea')
    document.body.append(editor)
    let returned = 0
    const controller = createRenameWidgetController({
      document,
      themeSource: document.body,
      returnFocus: () => {
        returned += 1
        editor.focus()
      },
    })
    const anchor = new DOMRect(10, 20, 40, 18)
    const signal = new AbortController().signal

    for (const key of ['Escape', 'Enter']) {
      const settled = controller.prompt({ anchor, currentName: 'name', signal })
      renameInput().dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      )
      await settled
    }
    expect(returned).toBe(2)
    expect(document.activeElement).toBe(editor)

    const clickedAway = controller.prompt({ anchor, currentName: 'name', signal })
    const elsewhere = document.createElement('button')
    document.body.append(elsewhere)
    elsewhere.focus()
    await clickedAway

    expect(returned).toBe(2)
    expect(document.activeElement).toBe(elsewhere)
    controller.dispose()
  })

  it('does not show an already-aborted prompt', async () => {
    const controller = createRenameWidgetController({ document, themeSource: document.body })
    const abort = new AbortController()
    abort.abort()

    await expect(
      controller.prompt({
        anchor: new DOMRect(10, 20, 40, 18),
        currentName: 'value',
        signal: abort.signal,
      }),
    ).resolves.toBeNull()
    expect(renameElement().style.display).toBe('none')
    expect(renameAnchorElement().style.display).toBe('none')
    controller.dispose()
  })

  it('aborts closes and settles a mounted prompt exactly once', async () => {
    const controller = createRenameWidgetController({ document, themeSource: document.body })
    const abort = new AbortController()
    const result = controller.prompt({
      anchor: new DOMRect(10, 20, 40, 18),
      currentName: 'value',
      signal: abort.signal,
    })

    abort.abort()
    abort.abort()

    await expect(result).resolves.toBeNull()
    expect(renameElement().style.display).toBe('none')
    expect(renameAnchorElement().style.display).toBe('none')
    controller.dispose()
  })
})

function renameElement(): HTMLElement {
  const element = document.body.querySelector<HTMLElement>('.lsp-plugin-rename')
  if (!element) throw new Error('missing rename input')
  return element
}

function renameAnchorElement(): HTMLElement {
  const element = document.body.querySelector<HTMLElement>('.lsp-plugin-rename-anchor')
  if (!element) throw new Error('missing rename anchor')
  return element
}

function renameInput(): HTMLInputElement {
  const input = renameElement().querySelector('input')
  if (!input) throw new Error('missing rename field')
  return input
}
