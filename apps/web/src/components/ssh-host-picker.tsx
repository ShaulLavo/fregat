import { Input } from '@workspace/ui/components/input'
import { SshHostList } from '@/components/ssh-host-list'
import { TailnetHostList } from '@/components/tailnet-host-list'

export function SshHostPicker({
  id,
  value,
  onChange,
}: {
  readonly id: string
  readonly value: string
  readonly onChange: (target: string) => void
}) {
  return (
    <div className='flex min-w-0 flex-col gap-2 sm:col-span-2'>
      <label className='text-xs font-medium' htmlFor={id}>
        SSH target
      </label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder='Search machines or enter user@host'
        autoComplete='off'
        autoCapitalize='none'
        spellCheck={false}
      />
      <div role='group' aria-label='SSH hosts' className='border-border rounded-md border'>
        <p className='text-muted-foreground border-border border-b px-3 py-2 text-xs font-medium'>
          SSH config
        </p>
        <SshHostList value={value} onSelect={onChange} />
      </div>
      <div role='group' aria-label='Tailnet machines' className='border-border rounded-md border'>
        <p className='text-muted-foreground border-border border-b px-3 py-2 text-xs font-medium'>
          Tailnet
        </p>
        <TailnetHostList value={value} onSelect={onChange} />
      </div>
    </div>
  )
}
