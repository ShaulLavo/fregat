import { SignInIcon } from '@phosphor-icons/react'
import { CommandItem } from '@workspace/ui/components/command'

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
      className='compact:gap-1.5 compact:px-1.5 compact:py-1.5 cursor-pointer gap-2 rounded-md px-2 py-2'
      value={`sign-in:${target.providerInstanceId}`}
      onSelect={() => onSelect(target)}
    >
      <SignInIcon className='text-muted-foreground size-3 shrink-0' />
      <span className='min-w-0 flex-1 text-left'>
        <span className='block truncate text-xs leading-snug font-medium'>
          Sign in to {target.providerLabel}
        </span>
        <span className='text-muted-foreground/70 compact:mt-0.5 mt-1 block truncate text-xs leading-snug font-normal'>
          Opens a browser tab through the {target.providerLabel} CLI.
        </span>
      </span>
    </CommandItem>
  )
}
