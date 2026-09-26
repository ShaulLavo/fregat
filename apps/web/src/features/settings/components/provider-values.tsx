import type { ProviderInstanceConfig } from '@workspace/contracts'
import { ValueGrid, ValueGridRow } from '@workspace/ui/components/value-grid'

import { CopyButton } from '@/components/copy-button'
import {
  environmentVariableReference,
  environmentVariableState,
} from '@/features/settings/utils/provider-values'

/**
 * The binary and every environment variable a provider starts with. A secret never has a copy
 * action for its value; the agent view offers the variable's reference instead.
 */
export function ProviderValues({
  agentView,
  instance,
}: {
  readonly agentView: boolean
  readonly instance: ProviderInstanceConfig
}) {
  const binary = instance.binaryPath
  return (
    <ValueGrid>
      <ValueGridRow
        action={binary === '' ? null : <CopyButton label='binary path' text={binary} />}
        label='Binary'
        title={binary === '' ? undefined : binary}
        value={binary === '' ? 'Resolved from PATH' : binary}
      />
      {instance.environment.map((variable) => {
        const reference = environmentVariableReference(variable)
        return (
          <ValueGridRow
            action={agentView ? <CopyButton label={reference} text={reference} /> : null}
            key={variable.name}
            label={variable.name}
            title={variable.name}
            value={agentView ? reference : environmentVariableState(variable)}
          />
        )
      })}
    </ValueGrid>
  )
}
