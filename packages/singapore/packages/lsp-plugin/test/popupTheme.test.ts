import { expect, it } from 'vitest'
import { createRenameWidgetController } from '../src/renameWidget'

it('clears a removed popup theme color when the rename widget is reused', async () => {
  const source = document.createElement('div')
  document.body.append(source)
  source.style.setProperty('--editor-popup-background', '#123456')
  const widget = createRenameWidgetController({ document, themeSource: source })
  const first = new AbortController()
  const pending = widget.prompt({
    anchor: new DOMRect(),
    currentName: 'name',
    signal: first.signal,
  })
  first.abort()
  await pending
  source.style.removeProperty('--editor-popup-background')
  const second = new AbortController()
  const next = widget.prompt({ anchor: new DOMRect(), currentName: 'name', signal: second.signal })
  expect(
    document
      .querySelector<HTMLElement>('.lsp-plugin-rename')
      ?.style.getPropertyValue('--editor-popup-background'),
  ).toBe('')
  second.abort()
  await next
  widget.dispose()
  source.remove()
})
