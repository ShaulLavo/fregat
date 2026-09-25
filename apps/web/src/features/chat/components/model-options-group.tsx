import type { ProviderOptionDescriptor } from '@workspace/contracts'
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from '@workspace/ui/components/dropdown-menu'

import { EffortSparkle } from '@/features/chat/components/effort-sparkle'
import { effortSparkleLevel } from '@/features/chat/utils/effort-sparkle'

type SelectDescriptor = Extract<ProviderOptionDescriptor, { type: 'select' }>

export function ModelOptionsGroup({
  descriptor,
  first,
  locked,
  value,
  onSelect,
}: {
  readonly descriptor: SelectDescriptor
  readonly first: boolean
  /** The prompt body says “ultrathink”, so the menu cannot override it. */
  readonly locked: boolean
  readonly value: string
  readonly onSelect: (value: string) => void
}) {
  return (
    <DropdownMenuRadioGroup aria-label={descriptor.label} value={value}>
      {first ? null : <DropdownMenuSeparator className='my-1' />}
      {/* Inside the group: base-ui resolves the label against its group context. */}
      <DropdownMenuLabel data-tooltip={descriptor.description}>
        {descriptor.label}
      </DropdownMenuLabel>
      {locked ? (
        <p className='text-muted-foreground px-2 pb-1 text-xs'>
          Your prompt contains “ultrathink”. Remove it from the text to change this option.
        </p>
      ) : null}
      {descriptor.options.map((choice) => (
        <DropdownMenuRadioItem
          key={choice.id}
          closeOnClick
          aria-label={choice.label}
          aria-description={choice.description}
          data-tooltip={choice.description}
          disabled={locked}
          value={choice.id}
          onClick={() => onSelect(choice.id)}
        >
          <EffortSparkle level={effortSparkleLevel(choice.id)} />
          {choice.label}
          {choice.isDefault ? (
            <span className='text-muted-foreground text-2xs ml-auto'>Default</span>
          ) : null}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  )
}
