import { Button } from '@workspace/ui/components/button'
import { useState } from 'react'

import { MachineForm } from '@/features/settings/components/machine-form'
import { MachineRow } from '@/features/settings/components/machine-row'
import { useSettingValue } from '@/features/settings/hooks/use-setting-value'

export function MachinesSection({ disabled }: { readonly disabled: boolean }) {
  const machines = useSettingValue('environments.machines')
  const [adding, setAdding] = useState(false)

  return (
    <div className='flex w-full min-w-0 flex-col gap-3 @3xl/settings:w-[min(32rem,45vw)]'>
      <p className='text-muted-foreground text-xs'>
        Connecting a machine is equivalent to handing it a root shell as your user, in both
        directions.
      </p>
      <p className='text-muted-foreground text-xs'>
        The local machine is always available. SSH connections require the desktop app, Bun, and an
        existing Platform checkout on the remote machine.
      </p>
      {Object.entries(machines).map(([name, machine]) => (
        <MachineRow key={name} name={name} machine={machine} disabled={disabled} />
      ))}
      {adding && !disabled ? (
        <MachineForm onDone={() => setAdding(false)} />
      ) : (
        <Button
          className='self-start'
          disabled={disabled}
          variant='secondary'
          onClick={() => setAdding(true)}
        >
          Add machine
        </Button>
      )}
    </div>
  )
}
