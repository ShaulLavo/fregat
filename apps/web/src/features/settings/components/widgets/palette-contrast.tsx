import type { PaletteColors } from '@workspace/contracts'

import {
  appRoleLabel,
  contrastFailures,
  TEXT_CONTRAST_MINIMUM,
} from '@/features/settings/utils/palette-editing'

/** Text pairs under 4.5:1. Advisory: it never blocks Apply. */
export function PaletteContrast({ colors }: { readonly colors: PaletteColors }) {
  const failures = contrastFailures(colors)
  if (failures.length === 0) {
    return (
      <p className='text-muted-foreground text-xs' role='status'>
        Every text pair meets {TEXT_CONTRAST_MINIMUM}:1.
      </p>
    )
  }

  return (
    <ul aria-label='Low-contrast pairs' className='flex flex-col gap-1 text-xs' role='status'>
      {failures.map((failure) => (
        <li className='text-warning flex justify-between gap-2' key={failure.foreground}>
          <span>
            {appRoleLabel(failure.foreground)} on {appRoleLabel(failure.background)}
          </span>
          <span className='font-mono tabular-nums'>{failure.ratio.toFixed(2)}:1</span>
        </li>
      ))}
    </ul>
  )
}
