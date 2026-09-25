import { afterEach, describe, expect, it } from 'vitest'

import { Kbd } from '@workspace/ui/components/kbd'
import { mount } from '../../../test/render'

const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))

describe('Kbd', () => {
  // TooltipContent tightens its padding for this slot; a rename would silently undo that.
  it('renders a kbd element carrying the kbd slot', () => {
    const mounted = mount(<Kbd>⌘K</Kbd>)
    cleanups.push(mounted.unmount)
    const key = mounted.container.firstElementChild

    expect(key?.tagName).toBe('KBD')
    expect(key?.getAttribute('data-slot')).toBe('kbd')
    expect(key?.textContent).toBe('⌘K')
  })
})
