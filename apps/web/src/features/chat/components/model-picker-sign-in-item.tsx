import { SignInIcon } from '@phosphor-icons/react'
import { CommandItem } from '@workspace/ui/components/command'
import { stackedListRowClassName } from '@workspace/ui/patterns/list-row-classes'
import { cn } from '@workspace/ui/lib/utils'

import type { ProviderSignInTarget } from '@workspace/client-core/chat/providers/auth'

/**
 * The one enabled row in a signed-out provider's group. Every model above it is
 * disabled with "Sign in required", so this is where that sentence leads. Shares
 * the model row's geometry so it reads as part of the list, not as a banner.
 */
export function ModelPickerSignInItem({
  onSelect,
  target,
}: {
  readonly onSelect: (target: ProviderSignInTarget) => void
  readonly target: ProviderSignInTarget
}) {
  return (
    <CommandItem
      className={cn(stackedListRowClassName, 'cursor-pointer')}
      value={`sign-in:${target.providerInstanceId}`}
      onSelect={() => onSelect(target)}
    >
      <SignInIcon className='text-muted-foreground size-(--icon-size-sm) shrink-0' />
      <span className='min-w-0 flex-1 text-left'>
        <span className='block truncate text-xs leading-snug font-medium'>
          Sign in to {target.providerLabel}
        </span>
        <span className='text-muted-foreground mt-(--density-gap-tight) block truncate text-xs leading-snug font-normal'>
          Opens a browser tab through the {target.providerLabel} CLI.
        </span>
      </span>
    </CommandItem>
  )
}
