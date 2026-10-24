import { describe, expect, it } from 'vitest'

import { EditorFindWidget } from '../src/findWidget'
import { widgetOptions } from './findWidgetOptions'

describe('EditorFindWidget trailing inset', () => {
  it('rounds a fractional reservation outward', () => {
    const { root, widget } = mountWidget()

    widget.setTrailingInset(140.2)

    expect(root.style.marginRight).toBe('141px')

    widget.dispose()
  })

  it('drops the declaration when nothing is reserved', () => {
    const { root, widget } = mountWidget()

    widget.setTrailingInset(140)
    widget.setTrailingInset(0)

    expect(root.style.marginRight).toBe('')

    widget.dispose()
  })
})

function mountWidget(): { readonly root: HTMLElement; readonly widget: EditorFindWidget } {
  const container = document.createElement('div')
  const scrollElement = document.createElement('div')
  container.append(scrollElement)
  document.body.append(container)
  const widget = new EditorFindWidget(container, scrollElement, widgetOptions())
  const root = container.querySelector<HTMLElement>('.editor-find-widget')
  if (!root) throw new Error('missing find widget')
  return { root, widget }
}
