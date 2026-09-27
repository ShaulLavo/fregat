import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { Drawer, DrawerContent } from '@workspace/ui/components/drawer'

const mountedRoots: Array<{ container: HTMLElement; root: Root }> = []

afterEach(() => {
  for (const mounted of mountedRoots.splice(0)) {
    act(() => mounted.root.unmount())
    mounted.container.remove()
  }
})

function render(open: boolean) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mountedRoots.push({ container, root })
  const draw = (next: boolean) =>
    act(() =>
      root.render(
        <Drawer modal={false} open={next}>
          <DrawerContent aria-label='Studio'>
            <p data-testid='body'>Body</p>
          </DrawerContent>
        </Drawer>,
      ),
    )
  draw(open)
  return { container, draw }
}

describe('Drawer', () => {
  it('renders outside its host, so opening it leaves the host layout alone', () => {
    const { container } = render(true)

    const body = document.querySelector('[data-testid="body"]')
    expect(body).not.toBeNull()
    expect(container.contains(body)).toBe(false)
    // Base UI leaves focus guards in place; fixed, they take no room in the host's flow.
    for (const child of container.children) {
      expect((child as HTMLElement).style.position).toBe('fixed')
    }
  })

  it('leaves the page interactive while open without a modal', () => {
    const { container } = render(true)

    expect(container.closest('[inert], [aria-hidden="true"]')).toBeNull()
    expect(document.body.style.overflow).not.toBe('hidden')
  })

  it('removes its content once closed', async () => {
    const { draw } = render(true)

    draw(false)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    expect(document.querySelector('[data-testid="body"]')).toBeNull()
  })
})
