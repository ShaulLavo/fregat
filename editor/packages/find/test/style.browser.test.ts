import { describe, expect, it } from 'vitest'

import { EditorFindWidget } from '../src/findWidget'
import { widgetOptions } from './findWidgetOptions'
import '../src/style.css'

describe('find widget placement', () => {
  it('clears a trailing strip another overlay reserved', () => {
    const container = document.createElement('div')
    const scrollElement = document.createElement('div')
    const strip = document.createElement('div')
    container.style.height = '300px'
    container.style.position = 'relative'
    container.style.width = '900px'
    strip.style.bottom = '0'
    strip.style.position = 'absolute'
    strip.style.right = '0'
    strip.style.top = '0'
    strip.style.width = '140px'
    container.append(scrollElement, strip)
    document.body.append(container)

    const widget = new EditorFindWidget(container, scrollElement, widgetOptions())
    widget.show(false)
    const root = findWidgetElement(container)

    expect(root.getBoundingClientRect().right).toBeGreaterThan(strip.getBoundingClientRect().left)

    widget.setTrailingInset(140)

    expect(root.getBoundingClientRect().right).toBeLessThanOrEqual(
      strip.getBoundingClientRect().left,
    )

    widget.dispose()
    container.remove()
  })

  it('hands the margin back to the cascade when the strip is released', () => {
    const container = document.createElement('div')
    const scrollElement = document.createElement('div')
    const sheet = document.createElement('style')
    sheet.textContent = '.editor-find-widget { margin-right: 30px; }'
    container.append(scrollElement)
    document.head.append(sheet)
    document.body.append(container)

    const widget = new EditorFindWidget(container, scrollElement, widgetOptions())
    widget.show(false)
    const root = findWidgetElement(container)

    widget.setTrailingInset(64)
    expect(getComputedStyle(root).marginRight).toBe('64px')

    widget.setTrailingInset(0)

    expect(getComputedStyle(root).marginRight).toBe('30px')

    widget.dispose()
    container.remove()
    sheet.remove()
  })

  it('takes its layer from the editor stacking scale', () => {
    const container = document.createElement('div')
    const scrollElement = document.createElement('div')
    container.style.setProperty('--editor-z-overlay-widget', '210')
    container.append(scrollElement)
    document.body.append(container)

    const widget = new EditorFindWidget(container, scrollElement, widgetOptions())
    widget.show(false)

    expect(getComputedStyle(findWidgetElement(container)).zIndex).toBe('210')

    widget.dispose()
    container.remove()
  })
})

describe('find widget styles', () => {
  it('keeps the replace row hidden when collapsed', () => {
    const row = document.createElement('div')
    row.className = 'editor-find-row editor-find-replace-row'
    row.hidden = true
    document.body.appendChild(row)

    expect(getComputedStyle(row).display).toBe('none')

    row.hidden = false
    expect(getComputedStyle(row).display).toBe('flex')
    row.remove()
  })

  it('uses inherited editor theme colors', () => {
    const host = document.createElement('div')
    const widget = document.createElement('div')
    host.style.setProperty('--editor-background', 'rgb(250, 250, 250)')
    host.style.setProperty('--editor-foreground', 'rgb(15, 23, 42)')
    widget.className = 'editor-find-widget'
    host.append(widget)
    document.body.append(host)

    expect(getComputedStyle(widget).color).toBe('rgb(15, 23, 42)')
    host.remove()
  })
})

function findWidgetElement(container: HTMLElement): HTMLElement {
  const widget = container.querySelector<HTMLElement>('.editor-find-widget')
  if (!widget) throw new Error('missing find widget')
  return widget
}
