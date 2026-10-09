import { describe, expect, it } from 'vitest'

import { cn } from '@workspace/ui/lib/utils'

describe('cn', () => {
  it('resolves Tailwind conflicts the usual way', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })

  it('joins conditional objects and nested arrays before resolving conflicts', () => {
    expect(
      cn('p-2', false, null, undefined, 0, ['px-4', ['py-1']], {
        'text-sm': true,
        hidden: false,
      }),
    ).toBe('p-2 px-4 py-1 text-sm')
  })

  it('resolves classes a component has not used before', () => {
    expect(cn('snap-start', 'snap-end')).toBe('snap-end')
    expect(cn('mask-type-luminance', 'mask-type-alpha')).toBe('mask-type-alpha')
  })

  it('reads changed object and array inputs on repeated calls', () => {
    const classes = ['p-2']
    const states = { hidden: true }
    expect(cn(classes, states)).toBe('p-2 hidden')
    classes.push('p-4')
    states.hidden = false
    expect(cn(classes, states)).toBe('p-4')
  })

  it('keeps focus variants independent and resolves conflicts within each variant', () => {
    expect(
      cn(
        'focus-ring-inset-drawn',
        'focus-ring-inset',
        'hover:focus-ring',
        'hover:focus-ring-within',
      ),
    ).toBe('focus-ring-inset hover:focus-ring-within')
  })

  // Two of them on one element would both set box-shadow and the element would
  // draw whichever the stylesheet emitted last, not the one the call site meant.
  // The merge tables need to register custom @utility classes, which
  // is what makes this assertion worth having.
  it('treats the focus utilities as mutually exclusive', () => {
    expect(cn('focus-ring', 'focus-ring-inset')).toBe('focus-ring-inset')
    expect(cn('focus-ring-within', 'focus-ring')).toBe('focus-ring')
  })

  it('keeps a focus utility alongside classes it does not conflict with', () => {
    expect(cn('focus-ring', 'rounded-md')).toBe('focus-ring rounded-md')
  })

  // A ring class is a different class group, so the merge keeps both. It still
  // wins the box-shadow at CSS level, because Tailwind emits it after the custom
  // utilities at equal specificity — so this is how a call site opts out of the
  // halo. The border-color half of the utility survives, which no ring touches.
  it('keeps a ring class and the utility, so the ring can override at CSS level', () => {
    expect(cn('focus-ring', 'focus-visible:ring-0')).toBe('focus-ring focus-visible:ring-0')
  })
})
