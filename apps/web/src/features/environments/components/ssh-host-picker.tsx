import { MagnifyingGlassIcon } from '@phosphor-icons/react'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@workspace/ui/components/input-group'
import { SshHostList } from '@/features/environments/components/ssh-host-list'
import { TailnetHostList } from '@/features/environments/components/tailnet-host-list'

export function SshHostPicker({
  id,
  errorId,
  value,
  onChange,
}: {
  readonly id: string
  // Set only while the form shows an error about this target, so it doubles as the invalid flag.
  readonly errorId?: string
  readonly value: string
  readonly onChange: (target: string) => void
}) {
  return (
    <div className='flex min-w-0 flex-col gap-2 sm:col-span-2'>
      <label className='text-muted-foreground text-2xs font-medium' htmlFor={id}>
        SSH target
      </label>
      <InputGroup>
        <InputGroupAddon align='inline-start'>
          <MagnifyingGlassIcon aria-hidden='true' />
        </InputGroupAddon>
        <InputGroupInput
          id={id}
          aria-describedby={errorId}
          aria-invalid={errorId ? true : undefined}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          placeholder='Search machines or enter user@host'
          autoCapitalize='off'
          autoComplete='off'
          autoCorrect='off'
          spellCheck={false}
        />
      </InputGroup>
      <div role='group' aria-label='SSH hosts' className='bg-muted rounded-lg'>
        <p className='text-muted-foreground px-3 py-2 text-xs font-medium'>SSH config</p>
        <SshHostList value={value} onSelect={onChange} />
      </div>
      <div role='group' aria-label='Tailnet machines' className='bg-muted rounded-lg'>
        <p className='text-muted-foreground px-3 py-2 text-xs font-medium'>Tailnet</p>
        <TailnetHostList value={value} onSelect={onChange} />
      </div>
    </div>
  )
}
