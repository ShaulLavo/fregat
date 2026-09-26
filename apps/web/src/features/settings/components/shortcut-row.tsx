import { DotsThreeIcon, PencilSimpleIcon, PlusIcon, WarningIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { ListRow } from '@workspace/ui/patterns/list-row'
import { cn } from '@workspace/ui/lib/utils'
import type { HTMLAttributes, MouseEvent } from 'react'

import { ShortcutKeys } from '@/features/settings/components/shortcut-keys'
import {
  shortcutIdMatches,
  shortcutPlacesLabel,
  shortcutSourceLabel,
  shortcutTitle,
  type ShortcutRow as ShortcutRowModel,
} from '@/features/settings/utils/shortcut-rows'
import type { PlatformName } from '@workspace/client-core/commands/chord'
import { formatChord } from '@/keymap/utils/format-keys'

/** The desktop grid: command, keys, where, source, actions. */
export const SHORTCUT_COLUMNS =
  '@3xl/settings:grid @3xl/settings:grid-cols-[minmax(0,1fr)_12rem_10rem_4.5rem_3.25rem]'

export function ShortcutRow({
  keptNote,
  onChange,
  onMenu,
  platform,
  query,
  row,
  rowProps,
}: {
  /** The browser acts on this row's chord before the page sees it. */
  keptNote: string | null
  onChange: () => void
  onMenu: (anchor: HTMLElement) => void
  platform: PlatformName
  query: string
  row: ShortcutRowModel
  rowProps: HTMLAttributes<HTMLDivElement> & { 'aria-selected': boolean }
}) {
  const takenBy = row.shadowedBy ? shortcutTitle(row.shadowedBy) : null
  const where = takenBy ? `Taken by ${takenBy}` : shortcutPlacesLabel(row.places)
  const source = shortcutSourceLabel(row.source)
  const modified = row.source === 'custom' || row.source === 'removed'
  const bound = row.keys !== null

  return (
    <ListRow
      {...rowProps}
      className={cn(
        SHORTCUT_COLUMNS,
        '@3xl/settings:h-(--density-row-height)',
        '@max-3xl/settings:h-12 @max-3xl/settings:flex-col @max-3xl/settings:items-stretch @max-3xl/settings:justify-center @max-3xl/settings:gap-0.5',
      )}
      data-shortcut-command={row.command}
      data-shortcut-keys={row.keys ?? undefined}
      data-shortcut-row={row.id}
      onContextMenu={(event: MouseEvent<HTMLDivElement>) => {
        event.preventDefault()
        onMenu(event.currentTarget)
      }}
      onDoubleClick={onChange}
      role='option'
      title={rowTitle(row, where, keptNote, platform)}
    >
      {modified ? (
        <span
          aria-label='Modified'
          className='bg-info absolute top-1/2 left-0 h-3 w-0.5 -translate-y-1/2 rounded-full'
        />
      ) : null}
      <div className='flex min-w-0 items-center gap-2 @3xl/settings:contents'>
        <span className='flex min-w-0 flex-1 items-baseline gap-2 @max-3xl/settings:text-sm'>
          <span className='truncate'>{row.title}</span>
          {shortcutIdMatches(row, query) ? (
            <span className='text-muted-foreground text-2xs truncate font-mono'>{row.command}</span>
          ) : null}
        </span>
        <span className='flex min-w-0 shrink-0 items-center gap-1 @3xl/settings:overflow-hidden'>
          {row.keys ? (
            <ShortcutKeys keys={row.keys} platform={platform} struck={takenBy !== null} />
          ) : null}
          {keptNote ? (
            <WarningIcon
              aria-label={keptNote}
              className='text-warning size-(--icon-size-sm) shrink-0'
              data-tooltip={keptNote}
            />
          ) : null}
        </span>
      </div>
      <div className='text-muted-foreground text-2xs flex min-w-0 items-center gap-1 @3xl/settings:contents @3xl/settings:text-xs'>
        {/* Kept even when empty on a desk row: the grid needs the Where cell. */}
        <span
          className={cn(
            'flex min-w-0 items-center gap-1',
            takenBy && 'text-warning',
            !where && '@max-3xl/settings:hidden',
          )}
        >
          {takenBy ? <WarningIcon aria-hidden className='size-(--icon-size-sm) shrink-0' /> : null}
          <span className='truncate'>{where}</span>
        </span>
        <span
          className={cn(
            'truncate',
            where && "@max-3xl/settings:before:pr-1 @max-3xl/settings:before:content-['·']",
          )}
        >
          {source}
        </span>
      </div>
      <div className='invisible hidden items-center justify-end gap-0.5 group-focus-within/row:visible group-hover/row:visible group-aria-selected/row:visible @3xl/settings:flex'>
        <Button
          aria-label={bound ? `Change shortcut for ${row.title}` : `Add shortcut for ${row.title}`}
          data-tooltip={bound ? 'Change shortcut' : 'Add shortcut'}
          onClick={onChange}
          size='icon-xs'
          variant='ghost'
        >
          {bound ? <PencilSimpleIcon /> : <PlusIcon />}
        </Button>
        <Button
          aria-label={`More actions for ${row.title}`}
          data-tooltip='More actions'
          onClick={(event) => onMenu(event.currentTarget)}
          size='icon-xs'
          variant='ghost'
        >
          <DotsThreeIcon />
        </Button>
      </div>
    </ListRow>
  )
}

/** Everything the row cannot show: the id, every chord, every place, and who took a chord. */
function rowTitle(
  row: ShortcutRowModel,
  where: string,
  keptNote: string | null,
  platform: PlatformName,
): string {
  const parts = [`${row.title} (${row.command})`]
  if (row.keys) parts.push(formatChord(row.keys, platform))
  if (row.commandKeys.length > 1) parts.push(`${row.commandKeys.length} shortcuts`)
  if (row.places.length > 0) parts.push(row.places.join('; '))
  if (row.shadowedBy) parts.push(where)
  if (keptNote) parts.push(keptNote)

  return parts.join(' · ')
}
