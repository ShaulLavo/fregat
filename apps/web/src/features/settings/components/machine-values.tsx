import type { MachineDefinition } from '@workspace/contracts'
import { ValueGrid, ValueGridRow } from '@workspace/ui/components/value-grid'

import { CopyButton } from '@/components/copy-button'

/** Where a machine is reached, one value per row, each with its own copy. */
export function MachineValues({
  machine,
  name,
}: {
  readonly machine: MachineDefinition
  readonly name: string
}) {
  return (
    <ValueGrid>
      <ValueGridRow
        label='Name'
        value={name}
        title={name}
        action={<CopyButton label='name' text={name} />}
      />
      {machine.kind === 'ssh' ? (
        <>
          <ValueGridRow
            label='SSH target'
            value={machine.target}
            title={machine.target}
            action={<CopyButton label='SSH target' text={machine.target} />}
          />
          {machine.remotePort === undefined ? null : (
            <ValueGridRow label='Remote port' value={machine.remotePort} />
          )}
        </>
      ) : (
        <ValueGridRow
          label='URL'
          value={machine.url}
          title={machine.url}
          action={<CopyButton label='URL' text={machine.url} />}
        />
      )}
    </ValueGrid>
  )
}
