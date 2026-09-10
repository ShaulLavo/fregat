import * as v from 'valibot'

export const machineNameSchema = v.pipe(
  v.string(),
  v.minLength(1, 'Give the machine a name.'),
  v.maxLength(48, 'Machine names must be 48 characters or fewer.'),
  v.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and single hyphens.'),
  v.check((value) => value !== 'local', 'The name local is reserved for the local machine.'),
)

const labelSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80))
const portSchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65_535))
const sshTargetSchema = v.pipe(
  v.string(),
  v.regex(
    /^(?:[a-zA-Z0-9_][a-zA-Z0-9_.-]*@)?[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/,
    'Use an SSH host or user@host. Configure ports and keys in ~/.ssh/config.',
  ),
  v.maxLength(255),
)
const originSchema = v.pipe(
  v.string(),
  v.url('Use a complete https:// or loopback http:// URL.'),
  v.check(isMachineOrigin, 'plain http off loopback is refused; use an SSH machine or https'),
  v.check(hasNoCredentials, 'Machine URLs cannot contain credentials, queries, or fragments.'),
)

export const sshMachineSchema = v.object({
  kind: v.literal('ssh'),
  target: sshTargetSchema,
  remotePort: v.optional(portSchema),
  label: v.optional(labelSchema),
})

export const originMachineSchema = v.object({
  kind: v.literal('origin'),
  url: originSchema,
  label: v.optional(labelSchema),
})

export const machineSchema = v.variant('kind', [sshMachineSchema, originMachineSchema])
export const machinesSchema = v.record(machineNameSchema, machineSchema)

export type MachineDefinition = v.InferOutput<typeof machineSchema>
export type SshMachineDefinition = v.InferOutput<typeof sshMachineSchema>
export type OriginMachineDefinition = v.InferOutput<typeof originMachineSchema>
export type Machines = v.InferOutput<typeof machinesSchema>

function isMachineOrigin(value: string): boolean {
  const url = URL.parse(value)
  if (!url) return false
  if (url.protocol === 'https:') return true
  if (url.protocol !== 'http:') return false
  return (
    url.hostname === 'localhost' ||
    url.hostname === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(url.hostname)
  )
}

function hasNoCredentials(value: string): boolean {
  const url = URL.parse(value)
  return Boolean(url && !url.username && !url.password && !url.search && !url.hash)
}
