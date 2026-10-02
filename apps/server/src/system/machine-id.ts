import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { machineIdSchema, type MachineId } from '@workspace/contracts'
import * as v from 'valibot'
import { systemErrors } from './structured-errors'

/** App-specific, as systemd recommends: the raw machine id is a secret of the OS. */
export function machineIdFrom(osMachineId: string): MachineId {
  const digest = createHash('sha256').update(`fregat:${osMachineId.trim()}`).digest('hex')
  return v.parse(machineIdSchema, digest.slice(0, 32))
}

let cached: MachineId | undefined

export function readMachineId(): MachineId {
  cached ??= machineIdFrom(readOsMachineId())
  return cached
}

function readOsMachineId() {
  if (process.platform === 'darwin') return macPlatformUuid()
  for (const file of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    try {
      const value = readFileSync(file, 'utf8').trim()
      if (value) return value
    } catch {
      continue
    }
  }
  throw machineIdError('linux')
}

function macPlatformUuid() {
  const result = Bun.spawnSync(['ioreg', '-rd1', '-c', 'IOPlatformExpertDevice'])
  const match = /"IOPlatformUUID" = "([^"]+)"/.exec(new TextDecoder().decode(result.stdout))
  if (!match?.[1]) throw machineIdError('darwin', result.exitCode)
  return match[1]
}

function machineIdError(platform: string, exitCode: number | null = null) {
  return systemErrors.MACHINE_ID_UNAVAILABLE({ internal: { platform, exitCode } })
}
