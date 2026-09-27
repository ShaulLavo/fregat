import { CaretDownIcon, CaretLeftIcon } from '@phosphor-icons/react'
import { useState, type ReactNode } from 'react'
import { Button } from '@workspace/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'

import { DraftSetupRow } from './draft-setup-row'

export type DraftSetupSection = {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly detail?: string
  readonly mono?: boolean
  readonly icon: ReactNode
  readonly disabled?: boolean
  /** The choices, shown in the sheet in place of the overview. */
  readonly choices: ReactNode
}

/** What the collapsed control shows: where the session runs, and its agent when not the default. */
export type DraftSetupSummary = {
  readonly lead: string | null
  /** A branch or folder name, set in the code face. */
  readonly where: string
  readonly agent: string | null
}

/**
 * The phone's draft context: one summary control under the composer, and one sheet listing every
 * setting. A row opens its choices inside the same sheet, so no sheet ever stacks on another.
 */
export function DraftSetupSheet({
  description,
  icon,
  sections,
  summary,
}: {
  /** Every setting in words: the control's accessible name and hover text. */
  readonly description: string
  readonly icon: ReactNode
  readonly sections: readonly DraftSetupSection[]
  readonly summary: DraftSetupSummary
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const open = sections.find((section) => section.id === openId) ?? null

  return (
    <div className='flex min-w-0'>
      <DropdownMenu
        onOpenChange={(next, details) => {
          if (next) {
            setOpenId(null)
            return
          }
          // A choice, or Escape (the phone's Back gesture sends it), returns to the overview first.
          if (open && (details.reason === 'item-press' || details.reason === 'escape-key')) {
            details.cancel()
            setOpenId(null)
          }
        }}
      >
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={`Session setup: ${description}`}
              className='text-muted-foreground max-w-full min-w-0 shrink font-normal'
              size='sm'
              title={description}
              type='button'
              variant='ghost'
            >
              {icon}
              {summary.lead ? <span className='shrink-0'>{summary.lead}</span> : null}
              <span className='min-w-0 truncate font-mono'>{summary.where}</span>
              {summary.agent ? (
                <span className='max-w-1/3 min-w-0 truncate'>· {summary.agent}</span>
              ) : null}
              <CaretDownIcon className='size-(--icon-size-sm) shrink-0 opacity-60' />
            </Button>
          }
        />
        <DropdownMenuContent>
          {open ? (
            <>
              <div className='bg-popover-solid sticky top-0 z-10 -mt-(--density-sheet-padding) pt-(--density-sheet-padding)'>
                <DropdownMenuItem
                  aria-label='Back to session setup'
                  closeOnClick={false}
                  onClick={() => setOpenId(null)}
                >
                  <CaretLeftIcon className='size-(--icon-size-sm)' />
                  Session setup
                </DropdownMenuItem>
              </div>
              {open.choices}
            </>
          ) : (
            <>
              <p className='text-foreground px-2 pt-1 pb-2 text-sm font-medium'>Session setup</p>
              {sections.map((section) => (
                <DraftSetupRow
                  key={section.id}
                  detail={section.detail}
                  disabled={section.disabled}
                  icon={section.icon}
                  label={section.label}
                  mono={section.mono}
                  value={section.value}
                  onOpen={() => setOpenId(section.id)}
                />
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
