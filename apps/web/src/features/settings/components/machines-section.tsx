import { Button } from '@workspace/ui/components/button'
import { useState } from 'react'

import { MachineForm } from '@/components/machine-form'
import { MachineRow } from '@/features/settings/components/machine-row'
import { useSettingValue } from '@/features/settings/hooks/use-setting-value'

export function MachinesSection({ disabled }: { readonly disabled: boolean }) {
  const machines = useSettingValue('environments.machines')
  const [adding, setAdding] = useState(false)

  return (
    <div className='flex w-full min-w-0 flex-col gap-3 @3xl/settings:w-[min(32rem,45vw)]'>
      <p className='text-muted-foreground text-xs'>
        Connect another machine to work with its projects. The local machine is always available.
      </p>
      {Object.entries(machines).map(([name, machine]) => (
        <MachineRow key={name} name={name} machine={machine} disabled={disabled} />
      ))}
      {adding && !disabled ? (
        <div className='border-border rounded-lg border p-4'>
          <MachineForm
            intent='connect'
            onCancel={() => setAdding(false)}
            onSaved={() => setAdding(false)}
          />
        </div>
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
