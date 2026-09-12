import { describe, expect, it } from 'vitest'

import { cn } from '@workspace/ui/lib/utils'

describe('cn', () => {
  it('resolves Tailwind conflicts the usual way', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })

  // Two of them on one element would both set box-shadow and the element would
  // draw whichever the stylesheet emitted last, not the one the call site meant.
  // tailwind-merge cannot see a custom @utility unless it is registered, which
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
