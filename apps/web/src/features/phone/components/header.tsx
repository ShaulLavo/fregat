import type { ReactNode } from 'react'
import { PaneBar } from '@workspace/ui/components/pane-bar'

import { ServerUpdateStatus } from '@/components/server-update-status'
import { BackButton } from '@/features/phone/components/back-button'
import { PaletteButton } from '@/features/phone/components/palette-button'

/** A phone screen's bar: Back, the title over its detail, the screen's actions, then the palette. */
export function Header({
  actions,
  detail,
  fullTitle,
  title,
}: {
  readonly actions?: ReactNode
  readonly detail?: ReactNode
  /** The untruncated title, for a value the bar may cut. */
  readonly fullTitle?: string
  readonly title: ReactNode
}) {
  return (
    <PaneBar as='header' className='text-foreground'>
      <BackButton />
      <div className='flex min-w-0 flex-1 flex-col justify-center' title={fullTitle}>
        <h1 className='truncate text-xs font-medium'>{title}</h1>
        {/* A flex row, so a chip keeps its own width and text still truncates. Bare text gets a
            span: a text node is no element for the row's truncation to reach. */}
        {detail ? (
          <div className='text-muted-foreground text-2xs flex min-w-0 [&>*]:min-w-0 [&>*]:truncate'>
            {typeof detail === 'string' ? <span>{detail}</span> : detail}
          </div>
        ) : null}
      </div>
      <div className='flex shrink-0 items-center gap-(--density-gap-tight)'>
        <ServerUpdateStatus />
        {actions}
        <PaletteButton />
      </div>
    </PaneBar>
  )
}
