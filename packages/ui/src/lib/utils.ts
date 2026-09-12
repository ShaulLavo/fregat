import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge only knows Tailwind's own classes, so a custom `@utility` is
 * invisible to it and never conflicts with anything. That matters in one place:
 * two of the focus utilities on the same element would both survive the merge
 * and both set `box-shadow`, so the element would draw whichever the stylesheet
 * emitted last rather than the one the call site meant. Registering them as one
 * class group makes them mutually exclusive, so the last one written wins.
 *
 * A Tailwind `ring-*` or `shadow-*` class is a different matter: it also
 * survives the merge, but at CSS level it is emitted after the custom utilities
 * at equal specificity, so it does take the `box-shadow` property. That is why
 * `focus-visible:ring-0` silences the halo — though not the `border-color` half,
 * which no ring class touches.
 */
const twMerge = extendTailwindMerge<'focus-ring'>({
  extend: {
    classGroups: {
      'focus-ring': ['focus-ring', 'focus-ring-within', 'focus-ring-inset'],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
