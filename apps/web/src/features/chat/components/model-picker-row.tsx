import { Badge } from '@workspace/ui/components/badge'
import { StatusDot } from '@workspace/ui/components/status-dot'
import { CommandItem } from '@workspace/ui/components/command'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { stackedListRowClassName } from '@workspace/ui/patterns/list-row-classes'
import { cn } from '@workspace/ui/lib/utils'

import { ProviderGlyph } from '@/features/chat/components/provider-glyph'
import { isNewProviderModel, modelPickerRowBadges } from '@/features/chat/utils/model-picker-badges'
import type { ProviderModelOption } from '@workspace/client-core/chat/providers/models'
import { modelDisabledTone } from '@/features/chat/utils/provider-status-tone'

/**
 * One model in the picker list: name over a provider line, with metadata chips
 * on the right. Highlight and the trailing check mark are both supplied by
 * `CommandItem` — the check is driven by `data-checked`, so this row must not
 * render one of its own or pass a `CommandShortcut`, which hides it.
 */
export function ModelPickerRow({
  onSelect,
  option,
  selected,
}: {
  readonly onSelect: (option: ProviderModelOption) => void
  readonly option: ProviderModelOption
  readonly selected: boolean
}) {
  const disabledReason = option.disabledReason
  const disabled = disabledReason !== null
  const badges = modelPickerRowBadges(option)
  const row = (
    <CommandItem
      className={cn(
        stackedListRowClassName,
        !disabled && 'cursor-pointer',
        // A natively inert row swallows hover, and the tooltip below is the only
        // place a blocked model says why it is blocked.
        disabled &&
          'data-[disabled=true]:pointer-events-auto data-[disabled=true]:cursor-not-allowed',
      )}
      data-checked={selected}
      disabled={disabled}
      // A blocked row is wrapped in the Tooltip below, and a native title beside it would show twice.
      title={disabled ? undefined : `${option.label} · ${option.providerLabel}`}
      value={option.key}
      onSelect={() => onSelect(option)}
    >
      <span className='min-w-0 flex-1 text-left'>
        <span className='flex min-w-0 items-center gap-1.5'>
          <span className='min-w-0 truncate text-xs leading-snug font-medium'>{option.label}</span>
          {isNewProviderModel(option) ? (
            <span className='bg-update/15 text-update text-3xs shrink-0 rounded-md px-0.5 py-px leading-none font-bold tracking-wide uppercase'>
              New
            </span>
          ) : null}
        </span>
        <span className='mt-(--density-gap-tight) flex min-w-0 items-center gap-1.5'>
          {/* 16px, not 12px: the monogram fallback for a provider we ship no mark
              for sets two letters at 10px, the smallest type step. */}
          <ProviderGlyph
            className='text-3xs size-4'
            displayLabel={option.providerLabel}
            driverKind={option.driverKind}
          />
          <span className='text-muted-foreground truncate text-xs leading-snug font-normal'>
            {disabledReason?.label ?? option.providerLabel}
          </span>
        </span>
      </span>
      <span className='flex shrink-0 items-center gap-1'>
        {badges.map((badge) => (
          <Badge
            className='text-muted-foreground text-3xs h-4 min-w-0 px-1.5 font-medium'
            key={badge.key}
            title={badge.title}
            variant='outline'
          >
            {badge.label}
          </Badge>
        ))}
        {disabled ? <StatusDot tone={modelDisabledTone(disabledReason.kind)} /> : null}
      </span>
    </CommandItem>
  )

  if (!disabledReason) return row

  return (
    <Tooltip>
      <TooltipTrigger render={row} />
      <TooltipContent align='center' className='max-w-64 leading-snug text-balance'>
        {disabledReason.message}
      </TooltipContent>
    </Tooltip>
  )
}
