import type { ProviderEnvironmentVariable } from '@workspace/contracts'

/** The client only ever holds the mask or nothing, so a variable is either set or not. */
export function environmentVariableState(variable: ProviderEnvironmentVariable) {
  return variable.value === '' ? 'Not set' : 'Set'
}

/** What an agent can paste to use the variable without ever seeing its value. */
export function environmentVariableReference(variable: ProviderEnvironmentVariable) {
  return `$${variable.name}`
}
