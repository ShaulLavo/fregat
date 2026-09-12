import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { PaneBar } from '@workspace/ui/components/pane-bar'

const mountedRoots: Array<{ container: HTMLElement; root: Root }> = []

afterEach(() => {
  for (const mounted of mountedRoots.splice(0)) {
    act(() => mounted.root.unmount())
    mounted.container.remove()
  }
})

describe('PaneBar', () => {
  it('renders a div by default and the requested element otherwise', () => {
    expect(bar(<PaneBar />).tagName).toBe('DIV')
    expect(bar(<PaneBar as='header' />).tagName).toBe('HEADER')
    expect(bar(<PaneBar as='footer' />).tagName).toBe('FOOTER')
  })

  it('puts the border on the requested edge and on no edge by default', () => {
    const bottom = classesOf(bar(<PaneBar border='bottom' />))
    expect(bottom).toContain('border-b')
    expect(bottom).toContain('border-border')

    const top = classesOf(bar(<PaneBar border='top' />))
    expect(top).toContain('border-t')
    expect(top).toContain('border-border')

    const plain = classesOf(bar(<PaneBar />))
    expect(plain).not.toContain('border-b')
    expect(plain).not.toContain('border-t')
    expect(plain).not.toContain('border-border')
  })

  it('merges className with the base classes', () => {
    const classes = classesOf(bar(<PaneBar className='justify-between' />))

    expect(classes).toContain('justify-between')
    expect(classes).toContain('h-(--bar-height)')
    expect(classes).toContain('px-(--bar-padding-x)')
    expect(classes).toContain('gap-(--density-control-gap)')
  })

  it('renders children', () => {
    expect(bar(<PaneBar>Header text</PaneBar>).textContent).toBe('Header text')
  })
})

function classesOf(element: HTMLElement): string[] {
  return element.className.split(' ')
}

function bar(element: React.ReactElement): HTMLElement {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mountedRoots.push({ container, root })

  act(() => {
    root.render(element)
  })

  const rendered = container.querySelector<HTMLElement>('[data-slot="pane-bar"]')
  if (!rendered) throw new Error('PaneBar did not render')

  return rendered
}
