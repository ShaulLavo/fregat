import { machineNameSchema, machineSchema, type MachineDefinition } from '@workspace/contracts'
import * as v from 'valibot'

export type MachineDraft = {
  readonly name: string
  readonly kind: MachineDefinition['kind']
  readonly label: string
  readonly target: string
  readonly remotePort: string
  readonly url: string
}

export function machineDraft(name = '', machine?: MachineDefinition): MachineDraft {
  return {
    name,
    kind: machine?.kind ?? 'ssh',
    label: machine?.label ?? '',
    target: machine?.kind === 'ssh' ? machine.target : '',
    remotePort: machine?.kind === 'ssh' ? String(machine.remotePort ?? '') : '',
    url: machine?.kind === 'origin' ? machine.url : '',
  }
}

export function parseMachineDraft(draft: MachineDraft) {
  const label = draft.label.trim() || undefined
  const input =
    draft.kind === 'ssh'
      ? {
          kind: draft.kind,
          target: draft.target.trim(),
          remotePort: draft.remotePort.trim() ? Number(draft.remotePort) : undefined,
          label,
        }
      : { kind: draft.kind, url: draft.url.trim(), label }
  const machine = v.safeParse(machineSchema, input)
  if (!machine.success) return { kind: 'invalid', message: machine.issues[0].message } as const
  const name = v.safeParse(
    machineNameSchema,
    draft.name.trim() || suggestedMachineName(machine.output),
  )
  if (!name.success) return { kind: 'invalid', message: name.issues[0].message } as const
  return { kind: 'valid', name: name.output, machine: machine.output } as const
}

function suggestedMachineName(machine: MachineDefinition): string {
  let address = machine.kind === 'ssh' ? machine.target : machine.url
  if (machine.kind === 'origin') {
    const url = new URL(machine.url)
    address = `${url.host}${url.pathname}`
  }
  const name = address
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
    .replace(/-$/, '')
  if (name === 'local') return 'remote-local'
  return name || 'remote'
}
