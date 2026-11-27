import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { machineIdSchema, type MachineId } from '@workspace/contracts'
import * as v from 'valibot'
import { platformHomePath } from '../home'
import { isWasiRuntime } from './runtime'
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

type MachineIdProvider = {
  platform: NodeJS.Platform
  arch?: string
  fallbackFile?: () => string
  readFile: (file: string) => string
  writeFileExclusive?: (file: string, value: string) => void
  run: (command: string[]) => { stdout: Uint8Array; exitCode: number | null }
}

const machineIdProvider: MachineIdProvider = {
  platform: process.platform,
  arch: process.arch,
  fallbackFile: () => platformHomePath('machine-id'),
  readFile: (file) => readFileSync(file, 'utf8'),
  writeFileExclusive: (file, value) => {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    writeFileSync(file, value, { flag: 'wx', mode: 0o600 })
  },
  run: (command) => Bun.spawnSync(command),
}

export function readOsMachineId(provider: MachineIdProvider = machineIdProvider) {
  if (provider.platform === 'darwin') return macPlatformUuid(provider)
  for (const file of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    const value = readOptionalFile(provider, file)
    if (value) return value
  }
  if (isWasiRuntime(provider.arch)) return persistedWasiMachineId(provider)
  throw machineIdError('linux')
}

function persistedWasiMachineId(provider: MachineIdProvider) {
  const file = (provider.fallbackFile ?? (() => platformHomePath('machine-id')))()
  const existing = readOptionalFile(provider, file)
  if (existing) return existing

  const generated = randomBytes(16).toString('hex')
  const writeExclusive = provider.writeFileExclusive ?? machineIdProvider.writeFileExclusive!
  try {
    writeExclusive(file, `${generated}\n`)
    return generated
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      const concurrent = readOptionalFile(provider, file)
      if (concurrent) return concurrent
    }
    return generated
  }
}

function readOptionalFile(provider: MachineIdProvider, file: string) {
  try {
    const value = provider.readFile(file).trim()
    return value || null
  } catch {
    return null
  }
}

function macPlatformUuid(provider: MachineIdProvider) {
  const result = provider.run(['/usr/sbin/ioreg', '-rd1', '-c', 'IOPlatformExpertDevice'])
  const match = /"IOPlatformUUID" = "([^"]+)"/.exec(new TextDecoder().decode(result.stdout))
  if (!match?.[1]) throw machineIdError('darwin', result.exitCode)
  return match[1]
}

function machineIdError(platform: string, exitCode: number | null = null) {
  return systemErrors.MACHINE_ID_UNAVAILABLE({ internal: { platform, exitCode } })
}
